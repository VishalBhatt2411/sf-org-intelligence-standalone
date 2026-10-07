import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../prisma";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// AI_PROVIDER picks which vendor answers "Explain with AI" — set it in backend/.env
// along with that vendor's API key. Defaults to Anthropic (matches the FRD).
type AiProvider = "anthropic" | "openai" | "gemini";

async function callAnthropic(prompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

async function callOpenAi(prompt: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error: ${data.error?.message || res.statusText}`);
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(prompt: string): Promise<string> {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1200 },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini error: ${data.error?.message || res.statusText}`);
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") || "";
}

const TRANSIENT_ERROR = /overloaded|high demand|rate limit|503|529/i;

async function callAiProvider(prompt: string): Promise<string> {
  const provider = (process.env.AI_PROVIDER as AiProvider) || "anthropic";
  const callers: Record<AiProvider, (prompt: string) => Promise<string>> = {
    anthropic: callAnthropic,
    openai: callOpenAi,
    gemini: callGemini,
  };
  const call = callers[provider];

  for (let attempt = 0; ; attempt++) {
    try {
      return await call(prompt);
    } catch (err) {
      const retryable = err instanceof Error && TRANSIENT_ERROR.test(err.message);
      if (!retryable || attempt >= 2) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

export async function explainFinding(findingId: string) {
  const finding = await prisma.finding.findUniqueOrThrow({ where: { id: findingId } });

  const prompt = `You are a Salesforce technical architect. A scan flagged this technical debt finding:

Category: ${finding.category}
Rule: ${finding.ruleKey}
Severity: ${finding.severity}
Component: ${finding.componentType} "${finding.componentName}"
Title: ${finding.title}
Detail: ${finding.detail}

Reply with exactly two sections, plain text, no markdown headers:
EXPLANATION: <2-3 sentences explaining why this matters in plain English>
RECOMMENDATION: <concrete, actionable steps to fix it>`;

  const text = await callAiProvider(prompt);

  const explanationMatch = text.match(/EXPLANATION:\s*([\s\S]*?)RECOMMENDATION:/i);
  const recommendationMatch = text.match(/RECOMMENDATION:\s*([\s\S]*)/i);

  const explanation = explanationMatch?.[1]?.trim() || text;
  const recommendation = recommendationMatch?.[1]?.trim() || "";

  return prisma.aiRecommendation.create({
    data: { findingId, explanation, recommendation },
  });
}

// Cap how much source we send per component — keeps token usage/cost bounded for large
// Apex classes/LWC bundles. Not persisted (no AiRecommendation row) since it's not tied to
// a finding; re-clicking "Explain" just asks the provider again.
const SOURCE_CHAR_LIMIT = 6000;

async function describeComponent(scanId: string, type: string, name: string): Promise<string | null> {
  switch (type) {
    case "ApexClass": {
      const row = await prisma.apexClass.findFirst({ where: { scanId, name } });
      return row ? `Apex class source:\n${row.body.slice(0, SOURCE_CHAR_LIMIT)}` : null;
    }
    case "ApexTrigger": {
      const row = await prisma.apexTrigger.findFirst({ where: { scanId, name } });
      return row ? `Apex trigger on object "${row.objectName}", source:\n${row.body.slice(0, SOURCE_CHAR_LIMIT)}` : null;
    }
    case "Flow": {
      const row = await prisma.flow.findFirst({ where: { scanId, apiName: name } });
      return row
        ? `Flow "${row.label}", status ${row.status}, trigger type ${row.triggerType || "none"}, object ${row.objectName || "n/a"}.`
        : null;
    }
    case "LightningWebComponent": {
      const row = await prisma.lwcComponent.findFirst({ where: { scanId, apiName: name } });
      return row ? `Lightning Web Component source:\n${row.source.slice(0, SOURCE_CHAR_LIMIT)}` : null;
    }
    case "SfObject": {
      const row = await prisma.sfObject.findFirst({ where: { scanId, apiName: name } });
      return row ? `Custom object "${row.label}" with ${row.fieldCount} fields.` : null;
    }
    case "SfField": {
      const [objectApiName, fieldApiName] = name.split(".");
      const row = objectApiName
        ? await prisma.sfField.findFirst({ where: { apiName: fieldApiName, object: { scanId, apiName: objectApiName } } })
        : null;
      return row ? `Field "${fieldApiName}" (type ${row.type}) on object "${objectApiName}".` : null;
    }
    case "WorkflowRule": {
      const [objectName, ruleName] = name.split(".");
      const row = await prisma.workflowRule.findFirst({ where: { scanId, objectName, name: ruleName } });
      return row
        ? `Workflow rule "${row.name}" on object "${row.objectName}", ${row.active ? "active" : "inactive"}, trigger type ${row.triggerType || "unknown"}.`
        : null;
    }
    case "ApexPage": {
      const row = await prisma.visualforcePage.findFirst({ where: { scanId, name } });
      return row ? `Visualforce page source:\n${row.markup.slice(0, SOURCE_CHAR_LIMIT)}` : null;
    }
    case "ApexComponent": {
      const row = await prisma.visualforceComponent.findFirst({ where: { scanId, name } });
      return row ? `Visualforce component source:\n${row.markup.slice(0, SOURCE_CHAR_LIMIT)}` : null;
    }
    case "EmailTemplate": {
      const row = await prisma.emailTemplate.findFirst({ where: { scanId, name } });
      return row
        ? `Email template "${row.name}" (developer name ${row.developerName}), type ${row.templateType}, ${row.isActive ? "active" : "inactive"}.`
        : null;
    }
    default:
      return null;
  }
}

export async function explainComponent(scanId: string, type: string, name: string): Promise<{ explanation: string }> {
  const description = await describeComponent(scanId, type, name);
  if (!description) throw new Error(`Component not found: ${type} "${name}"`);

  const prompt = `You are a Salesforce technical architect. Explain what this component does, in plain English, for someone unfamiliar with it. 3-5 sentences, no markdown, no headers.

Component type: ${type}
Name: ${name}
${description}`;

  const explanation = await callAiProvider(prompt);
  return { explanation: explanation.trim() };
}

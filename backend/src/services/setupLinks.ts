import { prisma } from "../prisma";

// Salesforce Setup deep-link URL patterns. Apex/Flow/Profile/PermissionSet/LWC pages need the
// component's Salesforce Id; Object Manager pages work off the API name directly.
export async function buildSetupUrl(
  instanceUrl: string,
  scanId: string,
  type: string,
  name: string
): Promise<string | null> {
  switch (type) {
    case "ApexClass": {
      const row = await prisma.apexClass.findFirst({ where: { scanId, name } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/ApexClasses/page?address=%2F${row.sfId}` : null;
    }
    case "ApexTrigger": {
      const row = await prisma.apexTrigger.findFirst({ where: { scanId, name } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/ApexTriggers/page?address=%2F${row.sfId}` : null;
    }
    case "Flow": {
      const row = await prisma.flow.findFirst({ where: { scanId, apiName: name } });
      return row?.sfId ? `${instanceUrl}/builder_platform_interaction/flowBuilder.app?flowId=${row.sfId}` : null;
    }
    case "LightningWebComponent": {
      const row = await prisma.lwcComponent.findFirst({ where: { scanId, apiName: name } });
      return row?.sfId
        ? `${instanceUrl}/lightning/setup/LightningComponentBundles/page?address=%2F${row.sfId}`
        : null;
    }
    case "Profile": {
      const row = await prisma.profile.findFirst({ where: { scanId, name } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/EnhancedProfiles/page?address=%2F${row.sfId}` : null;
    }
    case "PermissionSet": {
      const row = await prisma.permissionSet.findFirst({ where: { scanId, name } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/PermSets/page?address=%2F${row.sfId}` : null;
    }
    case "SfObject": {
      return `${instanceUrl}/lightning/setup/ObjectManager/${name}/Details/view`;
    }
    case "WorkflowRule": {
      const row = await prisma.workflowRule.findFirst({ where: { scanId, objectName: name.split(".")[0], name: name.split(".")[1] } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/WorkflowRules/page?address=%2F${row.sfId}` : null;
    }
    case "ApexPage": {
      const row = await prisma.visualforcePage.findFirst({ where: { scanId, name } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/ApexPages/page?address=%2F${row.sfId}` : null;
    }
    case "ApexComponent": {
      const row = await prisma.visualforceComponent.findFirst({ where: { scanId, name } });
      return row?.sfId ? `${instanceUrl}/lightning/setup/ApexComponent/page?address=%2F${row.sfId}` : null;
    }
    case "SfField": {
      // Field findings/rows use the "ObjectApiName.FieldApiName" convention (see dataQuality.ts / ComponentsPage).
      const [objectApiName, fieldApiName] = name.split(".");
      if (!objectApiName || !fieldApiName) return null;
      return `${instanceUrl}/lightning/setup/ObjectManager/${objectApiName}/FieldsAndRelationships/${fieldApiName}/view`;
    }
    default:
      return null;
  }
}

import { Box, Paper, Typography } from "@mui/material";

const COPY = {
  object: { title: "Ready to map", body: "Pick an object above to see which objects reference it and which it references." },
  field: { title: "Ready to map", body: "Pick a relationship field above to see the objects it connects and what depends on it." },
  record: { title: "Ready to map", body: "Choose an object, then a record, to see its parent and child records live from the org." },
} as const;

// The empty state before anything is anchored, shared by the analyze modes.
export function ReadyToMap({ lens }: { lens: keyof typeof COPY }) {
  const c = COPY[lens];
  return (
    <Box sx={{ flexGrow: 1, display: "flex", alignItems: "center", justifyContent: "center", p: 3 }}>
      <Paper variant="outlined" sx={{ p: 5, maxWidth: 440, textAlign: "center" }}>
        <Typography variant="h6" gutterBottom>
          {c.title}
        </Typography>
        <Typography color="text.secondary">{c.body}</Typography>
      </Paper>
    </Box>
  );
}

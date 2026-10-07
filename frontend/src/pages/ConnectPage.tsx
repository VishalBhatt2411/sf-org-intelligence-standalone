import { Box, Button, Typography, Paper, Stack } from "@mui/material";

export function ConnectPage() {
  const apiUrl = import.meta.env.VITE_API_URL;

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        p: 2,
      }}
    >
      <Paper sx={{ p: 5, maxWidth: 460, width: "100%", textAlign: "center" }}>
        <Box
          sx={{
            width: 56,
            height: 56,
            mx: "auto",
            mb: 3,
            borderRadius: "16px",
            background: "linear-gradient(150deg, #5C7BF7, #7A4FE0)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 500,
          }}
        >
          td
        </Box>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 1 }}>
          for Salesforce
        </Typography>
        <Typography variant="h5" gutterBottom>
          Salesforce Tech Debt AI
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          First time for an org: a browser window opens for you to log in via Salesforce CLI,
          then you'll land on Salesforce's own Allow screen, then back here.
        </Typography>
        <Stack direction="row" spacing={2} justifyContent="center">
          <Button variant="contained" size="large" href={`${apiUrl}/auth/salesforce/login?env=sandbox`}>
            Sandbox
          </Button>
          <Button variant="outlined" size="large" href={`${apiUrl}/auth/salesforce/login?env=production`}>
            Production
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: "block" }}>
          Requires the Salesforce CLI ("sf") installed on this machine the first time you
          connect to a given org.
        </Typography>
      </Paper>
    </Box>
  );
}

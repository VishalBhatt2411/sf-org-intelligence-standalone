import { createTheme } from "@mui/material/styles";

// Palette: cobalt (brand/focus) · sage (success) · marigold (warning/accent) · red (danger).
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#2B50DD", dark: "#1F3DBC", light: "#5C7BF7" },
    secondary: { main: "#2B50DD" },
    background: { default: "#F4F6F9", paper: "#ffffff" },
    text: { primary: "#11151B", secondary: "#5E6878" },
    divider: "rgba(17, 21, 27, 0.08)",
    success: { main: "#14854F" },
    warning: { main: "#EE9A12" },
    error: { main: "#D93A3F" },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: ["-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto", "Arial", "sans-serif"].join(","),
    h1: { fontWeight: 500, letterSpacing: -0.02 },
    h2: { fontWeight: 500, letterSpacing: -0.02 },
    h3: { fontWeight: 500, letterSpacing: -0.02 },
    h4: { fontWeight: 500, letterSpacing: -0.02 },
    h5: { fontWeight: 500 },
    h6: { fontWeight: 500 },
    subtitle1: { fontWeight: 500 },
    subtitle2: { fontWeight: 500 },
    overline: { fontWeight: 500, letterSpacing: 0.8 },
    button: { fontWeight: 500 },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "#ffffff",
          color: "#11151B",
          boxShadow: "none",
          borderBottom: "1px solid rgba(17, 21, 27, 0.08)",
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 44 },
        indicator: { height: 3, borderRadius: 3 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 500, minHeight: 44, fontSize: "0.9rem" },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 500, borderRadius: 10 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        elevation1: {
          border: "1px solid rgba(17, 21, 27, 0.08)",
          boxShadow: "0 1px 2px rgba(17, 21, 27, 0.05), 0 8px 20px rgba(17, 21, 27, 0.05)",
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 500 } },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: "none",
          borderRight: "1px solid rgba(17, 21, 27, 0.08)",
          boxShadow: "none",
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          "&.Mui-selected": {
            backgroundColor: "rgba(43, 80, 221, 0.1)",
            "&:hover": { backgroundColor: "rgba(43, 80, 221, 0.14)" },
          },
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          "&:before": { display: "none" },
          border: "1px solid rgba(17, 21, 27, 0.08)",
          borderRadius: 12,
          marginBottom: 8,
          "&.Mui-expanded": { margin: "0 0 8px 0" },
        },
      },
    },
  },
});

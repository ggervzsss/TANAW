import type { Preview } from "@storybook/react-vite";
import { withThemeByClassName } from "@storybook/addon-themes";
import "./preview.css";

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true, sort: "requiredFirst" },
    backgrounds: { disable: true },
    a11y: { test: "error" },
    options: {
      storySort: {
        order: ["Introduction", "Foundations", ["Colors", "Typography", "Shape and depth", "Writing"], "Components", "Patterns", "Guides"],
      },
    },
  },
  // Toggles the same .dark class on <html> that both apps use.
  decorators: [withThemeByClassName({ themes: { Light: "", Dark: "dark" }, defaultTheme: "Light", parentSelector: "html" })],
  tags: ["autodocs"],
};

export default preview;

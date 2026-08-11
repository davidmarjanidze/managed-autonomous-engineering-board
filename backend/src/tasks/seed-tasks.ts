import { type Task } from "@src/tasks/tasks.service";

export const seedTasks: Task[] = [
  {
    id: "T-1",
    title: "Fix property card text alignment",
    description:
      "Update the property card layout so the title and location block is left-aligned and properly spaced next to the price again. The current Tailwind classes shift the text block to the right and make the card content visibly misaligned. Restore the intended layout and verify the app still builds successfully.",
    phase: "todo",
  },
  {
    id: "T-2",
    title: "Add dark mode toggle button",
    description:
      'Add a dark mode toggle button in the header so users can switch between light and dark themes. The control should be minimal, easy to reach, and keep the existing layout intact while updating the app styling consistently across the main header, side menu, and property cards. The button should display a single word label: "Light" or "Dark" depending on the current theme.',
    phase: "todo",
  },
  {
    id: "T-3",
    title: "Add minimal side menu toggle",
    description:
      "Add a minimalistic left-side menu that can be toggled from the leftmost control in the header. When the toggle is clicked, the side menu should open and close cleanly without disrupting the main property grid layout. Keep the UI compact and ensure the interaction works on all supported screen sizes.",
    phase: "todo",
  },
];

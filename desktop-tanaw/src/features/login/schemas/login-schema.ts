import { z } from "zod";

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!value) {
        ctx.addIssue({ code: "custom", message: "Please enter your username or email." });
        return;
      }

      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const usernamePattern = /^[a-zA-Z0-9._-]{3,}$/;

      if (!emailPattern.test(value) && !usernamePattern.test(value)) {
        ctx.addIssue({ code: "custom", message: "Enter a valid username or email." });
      }
    }),
  password: z.string().superRefine((value, ctx) => {
    if (!value.trim()) {
      ctx.addIssue({ code: "custom", message: "Please enter your password." });
      return;
    }
  }),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

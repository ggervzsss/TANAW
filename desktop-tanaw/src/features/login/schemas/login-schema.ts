import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "../../../utils/password-policy";

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
    if (Array.from(value.normalize("NFC")).length > PASSWORD_MAX_LENGTH) {
      ctx.addIssue({ code: "custom", message: `Password must contain no more than ${PASSWORD_MAX_LENGTH} characters.` });
    }
  }),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

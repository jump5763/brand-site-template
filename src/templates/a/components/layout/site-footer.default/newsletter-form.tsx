"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/templates/a/components/ui/button";
import { Input } from "@/templates/a/components/ui/input";
import { Label } from "@/templates/a/components/ui/label";

const newsletterSchema = z.object({
  email: z
    .string()
    .min(1, "Enter your email address.")
    .email("Enter a valid email address."),
});

type NewsletterValues = z.infer<typeof newsletterSchema>;

const EMAIL_FIELD_ID = "site-footer-newsletter-email";
const EMAIL_ERROR_ID = "site-footer-newsletter-email-error";

export type NewsletterFormProps = {
  emailLabel: string;
  placeholder: string;
  submitLabel: string;
  successMessage: string;
};

export function NewsletterForm({
  emailLabel,
  placeholder,
  submitLabel,
  successMessage,
}: NewsletterFormProps) {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<NewsletterValues>({
    resolver: zodResolver(newsletterSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = handleSubmit(() => {
    toast.success(successMessage);
    reset();
    setIsSubmitted(true);
  });

  return (
    <form noValidate onSubmit={onSubmit} className="w-full max-w-md">
      <Label htmlFor={EMAIL_FIELD_ID} className="sr-only">
        {emailLabel}
      </Label>
      <div className="flex flex-col gap-3 tablet:flex-row">
        <Input
          {...register("email")}
          id={EMAIL_FIELD_ID}
          type="email"
          autoComplete="email"
          placeholder={placeholder}
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? EMAIL_ERROR_ID : undefined}
          className="h-11"
        />
        <Button type="submit" className="h-11 shrink-0 px-6">
          {submitLabel}
        </Button>
      </div>
      {errors.email ? (
        <p id={EMAIL_ERROR_ID} className="mt-2 text-xs text-destructive">
          {errors.email.message}
        </p>
      ) : null}
      {isSubmitted ? (
        <p role="status" className="mt-2 text-sm font-medium text-primary">
          {successMessage}
        </p>
      ) : null}
    </form>
  );
}

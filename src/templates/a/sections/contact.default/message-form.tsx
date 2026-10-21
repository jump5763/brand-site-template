"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/templates/a/components/ui/button";
import { Input } from "@/templates/a/components/ui/input";
import { Label } from "@/templates/a/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/templates/a/components/ui/select";
import { Textarea } from "@/templates/a/components/ui/textarea";

const messageSchema = z.object({
  name: z.string().min(2, "Enter the name we should reply to."),
  email: z.string().min(1, "Enter your email address.").email("Enter a valid email address."),
  topic: z.string().min(1, "Choose the topic that fits best."),
  message: z.string().min(10, "Tell us a little more so we can route your note."),
});

type MessageValues = z.infer<typeof messageSchema>;

export type MessageFormProps = {
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  topicLabel: string;
  topicPlaceholder: string;
  topics: readonly string[];
  messageLabel: string;
  messagePlaceholder: string;
  submitLabel: string;
  successMessage: string;
};

const fieldIds = {
  name: "contact-message-name",
  nameError: "contact-message-name-error",
  email: "contact-message-email",
  emailError: "contact-message-email-error",
  topic: "contact-message-topic",
  topicError: "contact-message-topic-error",
  message: "contact-message-body",
  messageError: "contact-message-body-error",
} as const;

// Client island of the contact package: validates locally and confirms in place.
export function MessageForm({
  nameLabel,
  namePlaceholder,
  emailLabel,
  emailPlaceholder,
  topicLabel,
  topicPlaceholder,
  topics,
  messageLabel,
  messagePlaceholder,
  submitLabel,
  successMessage,
}: MessageFormProps) {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MessageValues>({
    resolver: zodResolver(messageSchema),
    defaultValues: { name: "", email: "", topic: "", message: "" },
  });

  const onSubmit = handleSubmit(() => {
    toast.success(successMessage);
    reset();
    setIsSubmitted(true);
  });

  return (
    <form noValidate onSubmit={onSubmit} className="mt-6">
      <div className="grid gap-5 tablet:grid-cols-2">
        <div>
          <Label htmlFor={fieldIds.name}>{nameLabel}</Label>
          <Input
            {...register("name")}
            id={fieldIds.name}
            autoComplete="name"
            placeholder={namePlaceholder}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? fieldIds.nameError : undefined}
            className="mt-2 h-11"
          />
          {errors.name ? (
            <p id={fieldIds.nameError} className="mt-2 text-xs text-destructive">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor={fieldIds.email}>{emailLabel}</Label>
          <Input
            {...register("email")}
            id={fieldIds.email}
            type="email"
            autoComplete="email"
            placeholder={emailPlaceholder}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? fieldIds.emailError : undefined}
            className="mt-2 h-11"
          />
          {errors.email ? (
            <p id={fieldIds.emailError} className="mt-2 text-xs text-destructive">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div className="tablet:col-span-2">
          <Label htmlFor={fieldIds.topic}>{topicLabel}</Label>
          <Controller
            control={control}
            name="topic"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange} name={field.name}>
                <SelectTrigger
                  id={fieldIds.topic}
                  aria-invalid={errors.topic ? true : undefined}
                  aria-describedby={errors.topic ? fieldIds.topicError : undefined}
                  className="mt-2 h-11"
                >
                  <SelectValue placeholder={topicPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {topics.map((topic) => (
                    <SelectItem key={topic} value={topic}>
                      {topic}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.topic ? (
            <p id={fieldIds.topicError} className="mt-2 text-xs text-destructive">
              {errors.topic.message}
            </p>
          ) : null}
        </div>

        <div className="tablet:col-span-2">
          <Label htmlFor={fieldIds.message}>{messageLabel}</Label>
          <Textarea
            {...register("message")}
            id={fieldIds.message}
            rows={5}
            placeholder={messagePlaceholder}
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={errors.message ? fieldIds.messageError : undefined}
            className="mt-2 min-h-[132px]"
          />
          {errors.message ? (
            <p id={fieldIds.messageError} className="mt-2 text-xs text-destructive">
              {errors.message.message}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 tablet:col-span-2 tablet:flex-row tablet:items-center">
          <Button type="submit" className="h-11 w-full tablet:w-auto tablet:px-8">
            {submitLabel}
          </Button>
          {isSubmitted ? (
            <p role="status" className="text-sm font-medium text-primary">
              {successMessage}
            </p>
          ) : null}
        </div>
      </div>
    </form>
  );
}

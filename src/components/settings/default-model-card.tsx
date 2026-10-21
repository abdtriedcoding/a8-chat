"use client";

import { useQuery } from "convex/react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useSetDefaultModel } from "@/hooks/use-set-default-model";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { LAB_NAMES, modelsByLab } from "../../../convex/lib/models";

/**
 * Sets the user's default model, which new chats start on. A pick saves
 * right away. The composer's model chip can set it too.
 */
export function DefaultModelCard() {
  const defaultModelId = useQuery(api.models.defaultModel);
  const setDefaultModel = useSetDefaultModel();

  async function change(modelId: string) {
    try {
      await setDefaultModel({ modelId });
      toast.success("Default model updated.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default model</CardTitle>
        <CardDescription>
          New chats start on this model. You can switch any chat&apos;s model
          from the composer.
        </CardDescription>
      </CardHeader>
      <CardContent className="py-4">
        <Field>
          <FieldLabel htmlFor="default-model">Model</FieldLabel>
          <NativeSelect
            id="default-model"
            value={defaultModelId ?? ""}
            onChange={(event) => void change(event.target.value)}
            disabled={!defaultModelId}
            className="w-full sm:w-72"
          >
            {modelsByLab().map(({ lab, models }) => (
              <NativeSelectOptGroup key={lab} label={LAB_NAMES[lab]}>
                {models.map((model) => (
                  <NativeSelectOption key={model.id} value={model.id}>
                    {model.name}
                  </NativeSelectOption>
                ))}
              </NativeSelectOptGroup>
            ))}
          </NativeSelect>
        </Field>
      </CardContent>
    </Card>
  );
}

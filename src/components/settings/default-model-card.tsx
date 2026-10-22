"use client";

import { useQuery } from "convex-helpers/react/cache/hooks";
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
import { useIsModelLocked } from "@/hooks/use-is-model-locked";
import { useSetDefaultModel } from "@/hooks/use-set-default-model";
import { errorMessage } from "@/lib/errors";
import { api } from "../../../convex/_generated/api";
import { modelsByLab } from "../../../convex/lib/models";

/**
 * Sets the user's default model, which new chats start on. A pick saves
 * right away. The composer's model chip can set it too. On Free, the Pro
 * models can't be picked.
 */
export function DefaultModelCard() {
  const defaultModelId = useQuery(api.models.defaultModel);
  const isLocked = useIsModelLocked();
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
              <NativeSelectOptGroup key={lab.id} label={lab.name}>
                {models.map((model) => {
                  const locked = isLocked(model);
                  return (
                    <NativeSelectOption
                      key={model.id}
                      value={model.id}
                      disabled={locked}
                    >
                      {locked ? `${model.name} (Pro)` : model.name}
                    </NativeSelectOption>
                  );
                })}
              </NativeSelectOptGroup>
            ))}
          </NativeSelect>
        </Field>
      </CardContent>
    </Card>
  );
}

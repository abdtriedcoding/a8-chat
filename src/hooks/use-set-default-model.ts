import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/** Sets the user's default model. Every picker shows it right away. */
export function useSetDefaultModel() {
  return useMutation(api.models.setDefaultModel).withOptimisticUpdate(
    (store, { modelId }) => {
      store.setQuery(api.models.defaultModel, {}, modelId);
    },
  );
}

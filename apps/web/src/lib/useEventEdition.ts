import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { getDefaultEvent, getEventEdition, getEventLifecycle } from "@candy-map/shared";

export function useEventEdition() {
  const [params] = useSearchParams();
  const defaultEdition = useMemo(() => getDefaultEvent(), []);
  const eventId = params.get("eventId") ?? defaultEdition.id;
  const selected = getEventEdition(eventId);
  const edition = selected ?? defaultEdition;
  return {
    edition, eventId, lifecycle: getEventLifecycle(edition),
    eventError: selected ? null : "This holiday edition is not supported. Choose a holiday from the selector.",
  };
}

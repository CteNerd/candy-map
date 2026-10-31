import { useEffect, useRef, useState } from "react";
import type { GeoPoint } from "@candy-map/shared";
import { loadGoogleLibrary } from "./googleMaps";

export interface SelectedAddress {
  point: GeoPoint;
  street: string;
  postalCode: string;
  country: string;
}

export function AddressSearch({ onSelect }: { onSelect: (address: SelectedAddress) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const selection = useRef(onSelect);
  useEffect(() => { selection.current = onSelect; }, [onSelect]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let autocomplete: google.maps.places.PlaceAutocompleteElement | undefined;
    let request = 0;
    const select = async ({ placePrediction }: google.maps.places.PlacePredictionSelectEvent) => {
      const currentRequest = ++request;
      setError(null);
      try {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ["location", "addressComponents"] });
        if (!active || currentRequest !== request) return;
        if (!place.location) throw new Error("This address has no map location. Choose another result.");
        const component = (type: string, short = false) => {
          const value = place.addressComponents?.find((item) => item.types.includes(type));
          return (short ? value?.shortText : value?.longText) ?? "";
        };
        selection.current({
          point: { lat: place.location.lat(), lon: place.location.lng() },
          street: [component("street_number"), component("route")].filter(Boolean).join(" "),
          postalCode: component("postal_code"), country: component("country", true).toLowerCase(),
        });
      } catch (err) {
        if (active && currentRequest === request) setError(err instanceof Error ? err.message : "Could not look up the address.");
      }
    };
    const failed = () => setError("Address search is unavailable. Check Places API (New), key restrictions and billing, or use the map.");
    loadGoogleLibrary("places").then(({ PlaceAutocompleteElement }) => {
      if (!active || !container.current) return;
      autocomplete = new PlaceAutocompleteElement({ placeholder: "Search an address or place" });
      autocomplete.setAttribute("aria-label", "Search an address or place");
      autocomplete.addEventListener("gmp-select", select);
      autocomplete.addEventListener("gmp-error", failed);
      container.current.appendChild(autocomplete);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Could not load address search.");
    });
    return () => {
      active = false;
      autocomplete?.removeEventListener("gmp-select", select);
      autocomplete?.removeEventListener("gmp-error", failed);
      autocomplete?.remove();
    };
  }, []);

  return <div className="address-search"><div ref={container} />{error && <p role="alert" className="muted">{error}</p>}</div>;
}

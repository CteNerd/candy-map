import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

export const GOOGLE_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
let configured = false;

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

export function loadGoogleLibrary<T extends keyof google.maps.ImportLibraryMap>(library: T) {
  if (!key || !GOOGLE_MAP_ID) {
    return Promise.reject(new Error("Configure VITE_GOOGLE_MAPS_API_KEY and VITE_GOOGLE_MAPS_MAP_ID to load Google Maps."));
  }
  if (!configured) {
    window.gm_authFailure = () => window.dispatchEvent(new Event("google-maps-auth-failure"));
    setOptions({ key, v: "weekly" });
    configured = true;
  }
  return importLibrary(library);
}

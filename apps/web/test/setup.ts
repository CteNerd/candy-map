import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.stubEnv("VITE_API_BASE_URL", "");
vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "");
vi.stubEnv("VITE_GOOGLE_MAPS_MAP_ID", "");
vi.stubEnv("VITE_COGNITO_DOMAIN", "");
vi.stubEnv("VITE_COGNITO_CLIENT_ID", "");

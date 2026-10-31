import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FindJoinNeighborhoodScreen } from "../src/screens/FindJoinNeighborhoodScreen";

afterEach(() => {
  cleanup();
});

describe("FindJoinNeighborhoodScreen", () => {
  it("flags a point inside the seeded neighborhood as containing it", async () => {
    render(<FindJoinNeighborhoodScreen />);

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "37.7765" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-122.428" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Contains this point")).toBeInTheDocument());
  });

  it("flags a point outside the seeded neighborhood as nearby only", async () => {
    render(<FindJoinNeighborhoodScreen />);

    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Nearby")).toBeInTheDocument());
  });
});

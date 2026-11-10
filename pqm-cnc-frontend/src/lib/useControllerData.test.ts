import { expect, it } from "vitest";
import { controllerOffset } from "./useControllerData";

it("maps signed controller wear and geometry without scaling", () => {
  const row = { timestamp: "", xWearMm: -0.1, zWearMm: 0, xGeometryMm: 2, zGeometryMm: 5 };
  expect(controllerOffset(row, "x")).toEqual({ wear: -0.1, geometry: 2, offset: 1.9 });
  expect(controllerOffset(row, "z")).toEqual({ wear: 0, geometry: 5, offset: 5 });
});
it("supports documented snake-case wear and leaves missing geometry/offset empty", () => {
  expect(controllerOffset({ timestamp: "", tool_wear_x_mm: 0.2 }, "x")).toEqual({ wear: 0.2, geometry: null, offset: null });
  expect(controllerOffset(undefined, "z")).toEqual({ wear: null, geometry: null, offset: null });
});

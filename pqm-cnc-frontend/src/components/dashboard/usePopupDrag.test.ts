// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePopupDrag } from "./usePopupDrag";

it("drags by the title, clamps movement, resets for a new task and ignores buttons", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  function Popup({ id }: { id: string }) {
    const drag = usePopupDrag(id);
    return React.createElement("div", { ref: drag.ref, style: drag.style },
      React.createElement("div", { ...drag.titleProps, "data-title": true }, "Title", React.createElement("button", null, "Action")));
  }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(Popup, { id: "1" })));
  const popup = host.firstElementChild as HTMLDivElement;
  const title = host.querySelector<HTMLDivElement>("[data-title]")!;
  popup.getBoundingClientRect = () => ({ left: 100, top: 100, right: 500, bottom: 400 } as DOMRect);
  title.setPointerCapture = vi.fn();
  const pointer = (target: Element, type: string, x: number, y: number) => act(async () => {
    const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(event, "pointerId", { value: 1 }); target.dispatchEvent(event);
  });
  await pointer(title, "pointerdown", 200, 120);
  await pointer(title, "pointermove", 230, 160);
  expect(popup.style.transform).toBe("translate(30px, 40px)");
  await pointer(title, "pointermove", -10000, -10000);
  expect(popup.style.transform).toBe("translate(-92px, -92px)");
  await pointer(title, "pointerup", 0, 0);
  await act(async () => root.render(React.createElement(Popup, { id: "2" })));
  expect(popup.style.transform).toBe("translate(0px, 0px)");
  await pointer(title.querySelector("button")!, "pointerdown", 200, 120);
  await pointer(title, "pointermove", 230, 160);
  expect(popup.style.transform).toBe("translate(0px, 0px)");
  await act(async () => root.unmount()); host.remove();
});

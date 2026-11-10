# Tool wear demo

Open `/dashboard`, then choose **Tool Wear**. Product Quality remains available.

1. Select a tool from the list. Only T06 has demo prediction data; T03 and T08 show empty states.
2. T06 displays a fixed demo snapshot with two independent health indicators and two separate trend charts. The simulation control block has been removed.
4. Offset calculation belongs to the machine after receiving predictions. This page does not calculate or apply offsets and has no machine feedback block.
5. Use **Add local photo** for an actual inspection image. Click the photo to enlarge it. Each tool has a separate photo; previews last only for the current page session and are not uploaded or saved.
6. The tool list stays on the left. On the right, row 1 contains the two health cards, row 2 the two trend charts, and row 3 the photo across both columns. Drag block corners to resize height and column dividers to resize width. Sizes persist in localStorage; Layout Lock disables resizing. The tool list stacks above the content on narrow screens.

Predictions, history and confidence are illustrative. No predictions or commands are sent to a physical machine; the real pipeline is not connected yet.

## Future integration

The current UI is self-contained in `src/components/dashboard/ToolWearDashboard.tsx`.
Replace the seeded T06 prediction with per-tool pipeline snapshots. Each snapshot needs tool ID, diameter wear, tool length wear, their thresholds and confidence, and observation time. Replace local photo object URLs with pipeline-provided image URLs plus capture timestamps. Keep image capture time distinct from prediction time.

The existing quality Copilot remains unchanged and is not yet aware of tool wear.

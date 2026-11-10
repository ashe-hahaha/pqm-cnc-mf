#!/usr/bin/env python3
"""Build the light-background PQM user-manual deck from captured screenshots."""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent
IMG = ROOT / "screenshots"
OUT_PPTX = ROOT / "PQM-User-Manual.pptx"

BG = RGBColor(0xF4, 0xF7, 0xFB)
INK = RGBColor(0x16, 0x32, 0x4F)
BODY = RGBColor(0x2C, 0x3E, 0x50)
MUTED = RGBColor(0x5C, 0x6E, 0x80)
ACCENT = RGBColor(0x2B, 0x6C, 0xB0)
CARD = RGBColor(0xFF, 0xFF, 0xFF)
LINE = RGBColor(0xD5, 0xDE, 0xE8)
GREEN = RGBColor(0x1F, 0x8A, 0x4C)
AMBER = RGBColor(0xB4, 0x7D, 0x0A)
ROSE = RGBColor(0xC4, 0x3B, 0x4E)

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


def set_run(paragraph, text, size, color, bold=False, font="Calibri"):
    run = paragraph.add_run()
    run.text = text
    run.font.size = Pt(size)
    run.font.color.rgb = color
    run.font.bold = bold
    run.font.name = font
    return run


def add_bg(slide):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SLIDE_W, SLIDE_H)
    shape.fill.solid()
    shape.fill.fore_color.rgb = BG
    shape.line.fill.background()
    bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, SLIDE_W, Inches(0.08))
    bar.fill.solid()
    bar.fill.fore_color.rgb = ACCENT
    bar.line.fill.background()


def add_footer(slide, n, total):
    box = slide.shapes.add_textbox(Inches(0.45), Inches(7.15), Inches(10.2), Inches(0.26))
    p = box.text_frame.paragraphs[0]
    set_run(p, "PQM dashboard review  ·  are these details right?", 11, MUTED)
    num = slide.shapes.add_textbox(Inches(11.2), Inches(7.15), Inches(1.7), Inches(0.26))
    q = num.text_frame.paragraphs[0]
    q.alignment = PP_ALIGN.RIGHT
    set_run(q, f"{n}  /  {total}", 11, MUTED)


def add_title(slide, kicker, title):
    k = slide.shapes.add_textbox(Inches(0.48), Inches(0.22), Inches(12.3), Inches(0.28))
    p = k.text_frame.paragraphs[0]
    set_run(p, kicker.upper(), 12, ACCENT, bold=True)
    t = slide.shapes.add_textbox(Inches(0.45), Inches(0.46), Inches(12.4), Inches(0.48))
    q = t.text_frame.paragraphs[0]
    set_run(q, title, 28, INK, bold=True)


def add_bullets(slide, items, left, top, width, height, size=15):
    box = slide.shapes.add_textbox(left, top, width, height)
    frame = box.text_frame
    frame.word_wrap = True
    for i, item in enumerate(items):
        p = frame.paragraphs[0] if i == 0 else frame.add_paragraph()
        p.level = 0
        p.space_after = Pt(6)
        set_run(p, item, size, BODY)
    return box


def fit_picture(slide, path, left, top, max_w, max_h):
    """Place a picture inside a white card, scaled to fit."""
    from PIL import Image

    with Image.open(path) as im:
        iw, ih = im.size
    max_w_px = max_w
    max_h_px = max_h
    scale = min(max_w_px / iw, max_h_px / ih)
    w = Emu(int(iw * scale))
    h = Emu(int(ih * scale))
    pad = Inches(0.08)
    card = slide.shapes.add_shape(
        MSO_SHAPE.ROUNDED_RECTANGLE,
        left - pad,
        top - pad,
        w + pad * 2,
        h + pad * 2,
    )
    card.fill.solid()
    card.fill.fore_color.rgb = CARD
    card.line.color.rgb = LINE
    card.shadow.inherit = False
    pic = slide.shapes.add_picture(str(path), left, top, w, h)
    return pic


def step_slide(prs, kicker, title, bullets, image, footer_n, total, pic_w=6.35):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(slide)
    add_title(slide, kicker, title)
    add_bullets(slide, bullets, Inches(0.48), Inches(1.12), Inches(5.55), Inches(5.85), 14)
    if image and Path(image).exists():
        fit_picture(slide, image, Inches(6.35), Inches(1.2), Inches(pic_w), Inches(5.55))
    add_footer(slide, footer_n, total)
    return slide


def build():
    slides = [
        (
            "01  ·  Production context",
            "What the job strip is showing",
            [
                "This strip is the job the predictions belong to. On this screen: Makino Slim3n, VALVE BODY A12, WO-20260501-07, program OP20_HOLE, tool T06 (Ø20 bore), material SS316L.",
                "Current operation reads the cut while a balloon is machining, and “Piece review” after the piece stops. Balloon is the feature selected for detail, or the one in cut.",
                "Batch progress (23 / 50) is parts finished on the order. Inspected parts (3 / 50) is how many of those went to CMM. They are order-level, not a score for the piece on screen.",
                "Confirm: are machine, product, work order, program, operation, tool, balloon, material, batch, and inspected count the right set — or should tool and operation change with every balloon?",
            ],
            IMG / "header.png",
        ),
        (
            "02  ·  Drawing source",
            "One print drives the map and the job name",
            [
                "The Drawing control lists prints already stored under data/MachiningData, grouped by job folder, plus anything uploaded in this session.",
                "Choosing a file replaces the center map. If the file belongs to a job, Product ID and Program on the strip follow that job. An upload stays under “Uploaded drawings” until it is filed with a job.",
                "Accepted files are a PDF or a shop picture. Page tabs are the sheets of that PDF. The count on a tab is how many balloons sit on that sheet.",
                "Confirm: is picking from the machining-data folder the right source, and should a new print always bring its own product and program?",
            ],
            IMG / "drawing-picker.png",
        ),
        (
            "02  ·  Balloon placement",
            "Each balloon is one feature on the print",
            [
                "A balloon is a numbered callout tied to one characteristic: a diameter, a position, a flatness, a length. It is placed on the view that shows that feature.",
                "Design mode is for authoring: click empty paper to drop balloons (Add sets how many), drag one onto the dimension, Delete removes the selected one. Locked is the running map, so a click inspects instead of moving.",
                "Positions stay with that drawing, so the same print opens with the same map. Page 1 (12) here means twelve balloons on the first sheet.",
                "Confirm: is one balloon per characteristic, placed by hand on the print, the right model — or should balloons come from the ballooned drawing / CMM plan automatically?",
            ],
            IMG / "drawing-design.png",
        ),
        (
            "02  ·  Balloon colors",
            "Green, orange, red — plus gray and purple",
            [
                "Green is pass. The prediction is inside specification with margin left. On this piece that is 10 of 12 balloons, including B2.",
                "Orange is warning. Still inside the limit, but close enough that the next parts can cross it. This piece has one: B3 position, margin +0.011 mm, pass probability 58%.",
                "Red is high risk. The prediction is outside the spec, or the pass probability is very low. This piece has one: B1 datum A flatness, 0.023 mm against ≤ 0.02 mm, pass probability 12%.",
                "Gray (N/M) is not machined yet on this piece, so there is no prediction. A purple ring is separate from quality: it marks the balloon in cut right now. A blue ring is the one opened for inspection.",
                "Rule on this demo: every finished piece is given exactly one red and one orange. The rest that finish are green. Confirm whether that mix, and these five colors, are the right language.",
            ],
            IMG / "drawing-design.png",
        ),
        (
            "03  ·  Left column",
            "Piece score, the cut, and what to do",
            [
                "Balloon quality summary is the color count for this piece only: green pass, orange warning, red high risk, gray not machined. Here the piece is finished, so not-machined is 0.",
                "Process context is the cut that produced the balloon in the header. Eight traces: feed, spindle speed, spindle load, material removal rate, estimated depth and width of cut, vibration RMS, acoustic RMS.",
                "The traces are setpoint-like: they step and hold, with a small wobble, and they restart from the left when the next balloon starts. After the piece stops, they stay on the last balloon until another is selected.",
                "Recommendations use the same colors: red HIGH (pull an extra sample on B1), orange REC (check tool and runout), blue INFO (watch B3), green OK (load the next piece). Confirm whether these four actions are the right response to one red and one orange.",
            ],
            IMG / "left.png",
        ),
        (
            "04  ·  Right column",
            "One balloon, in numbers, trend, and alerts",
            [
                "Selected balloon detail is the open feature: name and type, predicted value, spec, margin to the limit, pass probability, model confidence, and the last QC value. The badge repeats the balloon color.",
                "Quality trend is that same characteristic over recent parts: 20 predicted points and 3 measured QC points (yellow). The shaded band is LSL to USL. The badge is In control or Out of control.",
                "A pass and a warning both stay In control. Only the red case is Out of control, because the last prediction leaves the band. The line is a low-order curve, so a good part still wanders inside the band.",
                "Alerts are piece-level, not a second copy of the summary: review hold when the piece is done, then the red and the orange callouts. Selecting an alert opens that balloon. Confirm whether detail + trend + these three alerts is enough on the right.",
            ],
            IMG / "col-right-pass.png",
        ),
        (
            "05  ·  Green balloon",
            "Pass — inside the band, and not a flat line",
            [
                "Example: B2, overall length. Predicted 85.993 mm against 86.000 ± 0.05 mm. Margin +0.043 mm. Pass probability 94%. Confidence 90%. Last QC 85.989 mm.",
                "The balloon is green. The trend badge is In control. Both the prediction and the three QC points stay inside the band, but they move — a pass is not drawn as a straight line on the nominal.",
                "Margin is the room left before the nearest limit. Pass probability is the model’s chance this feature will meet spec. They can disagree in tone: a wide margin with a lower probability would still be worth a look.",
                "Confirm: is a wandering in-band trend convincing for a good feature, and are predicted value, margin, pass probability, and last QC the numbers you want on a green balloon?",
            ],
            IMG / "col-right-pass.png",
        ),
        (
            "05  ·  Orange balloon",
            "Warning — still legal, climbing toward the limit",
            [
                "Example: B3, position of a hole. Predicted 0.039 mm against ≤ 0.05 mm. Margin only +0.011 mm. Pass probability 58%. Confidence 84%. Last QC 0.028 mm.",
                "The balloon is orange, not red, because the prediction is still inside the spec. The trend stays In control, but it rises toward the upper line, and the later QC points sit near that edge.",
                "That is the warning story: nothing has failed on this part, and the direction says the next parts can go out if the process is left alone. The left column and the alert both say watch B3.",
                "Confirm: is “inside spec, but close and trending toward the limit” the right meaning of orange, and is 58% pass probability the right place to warn rather than fail?",
            ],
            IMG / "col-right-warn.png",
        ),
        (
            "05  ·  Red balloon",
            "High risk — the trend leaves the specification",
            [
                "Example: B1, datum A flatness. Predicted 0.023 mm against ≤ 0.02 mm. Margin −0.003 mm (already past the limit). Pass probability 12%. Confidence still 91%. Last QC 0.012 mm was inside.",
                "The balloon is red. The trend badge is Out of control: the prediction climbs through the band and the last point sits above the upper spec. The QC points follow that climb but have not all crossed yet.",
                "Confidence stays high while pass probability collapses. The model is sure of a bad answer. The suggested response is an extra sample plus a tool and runout check, not a silent continue.",
                "Confirm: should red mean “predicted outside spec,” even when the last measured point is still inside? And is one red balloon per piece the right demo, or too regular?",
            ],
            IMG / "col-right-risk.png",
        ),
        (
            "06  ·  Pareto",
            "Where this product has been failing",
            [
                "Under the drawing: failure modes for this product over the last 100 parts. Bars are counts. The line is the cumulative share.",
                "Diameter out is 42 of 100 (42%). Position error takes the running total to 66%. Roundness 80%, surface finish 91%, everything else 100%.",
                "This is history for the product, not the piece on the machine. It is there so a red diameter balloon can be read against a known weak mode.",
                "Confirm: is “this product, last 100 parts” the right window, and are these five modes the ones you want named?",
            ],
            IMG / "pareto.png",
        ),
        (
            "07  ·  Model performance",
            "Whether the number is worth acting on",
            [
                "Three gauges sit under the Pareto. Prediction confidence follows the open balloon (90% on green B2, 84% on orange B3, 91% on red B1). It is not a plant-wide score.",
                "Similar-jobs coverage is 86%: how much of this machine, material, and operation the model has seen before.",
                "QC coverage is 6% and drawn in red on purpose. Only 3 of 50 parts were inspected, so most balloons are prediction with a thin measured check. Model status is Healthy, with the last update dated on the panel.",
                "Confirm: should a low QC sample turn the gauge red even when confidence is high, and is “healthy” the right status word while coverage is this thin?",
            ],
            IMG / "model.png",
        ),
    ]

    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    prs.core_properties.title = "PQM dashboard review"
    prs.core_properties.subject = "Are these details right?"
    total = len(slides) + 2

    title = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(title)
    add_title(title, "Predictive quality monitoring", "Dashboard review")
    sub = title.shapes.add_textbox(Inches(0.48), Inches(1.15), Inches(7.4), Inches(0.7))
    sub.text_frame.word_wrap = True
    set_run(
        sub.text_frame.paragraphs[0],
        "Walk the screen and decide whether each detail is the right one to show.",
        18,
        BODY,
    )
    add_bullets(
        title,
        [
            "Production strip: what job the numbers belong to",
            "Drawing and balloons: one feature, one callout, five colors",
            "Left: piece score, process traces, recommended action",
            "Right: the open balloon, its trend, and the alerts",
            "Green, orange, and red — what the quality trend does in each case",
            "Pareto and model coverage: history, and how much to trust",
        ],
        Inches(0.48),
        Inches(2.05),
        Inches(6.5),
        Inches(4.4),
        16,
    )
    if (IMG / "raw-full.png").exists():
        fit_picture(title, IMG / "raw-full.png", Inches(7.15), Inches(1.7), Inches(5.6), Inches(4.8))
    add_footer(title, 1, total)

    for i, (kicker, heading, bullets, image) in enumerate(slides, start=2):
        step_slide(prs, kicker, heading, bullets, image, i, total)

    close = prs.slides.add_slide(prs.slide_layouts[6])
    add_bg(close)
    add_title(close, "To confirm", "Decisions this screen is making")
    add_bullets(
        close,
        [
            "Colors. Green = inside spec. Orange = inside spec but close, and the trend is moving toward the limit. Red = predicted outside spec. Gray = not cut yet. Purple ring = in cut now, and it does not replace the quality color.",
            "Mix. Each finished piece is shown with exactly one red balloon and one orange balloon. The other finished balloons are green. Is that a fair demo, or should a piece be allowed to finish all green?",
            "Trend. Twenty predicted points and three measured points. A green trend wanders inside the band. An orange trend climbs toward the limit and stays inside. A red trend leaves the band. Is that the picture you want an operator to trust?",
            "Scope. The left and right columns are this piece and this balloon. Pareto and QC coverage are the product and the batch. Confirm that split before we add or remove a panel.",
        ],
        Inches(0.5),
        Inches(1.25),
        Inches(12.3),
        Inches(5.5),
        18,
    )
    add_footer(close, total, total)

    prs.save(OUT_PPTX)
    print(f"wrote {OUT_PPTX} ({total} slides)")


if __name__ == "__main__":
    build()

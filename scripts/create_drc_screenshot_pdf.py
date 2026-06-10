from pathlib import Path
import shutil

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Image as FlowableImage
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_FILE = OUT_DIR / "depot-readiness-check-screenshot-overview.pdf"
SCREEN_DIR = ROOT / "tmp" / "drc-screenshots"
USER_SCREEN_DIR = Path.home() / "Desktop"
LOCAL_USER_SCREEN_DIR = SCREEN_DIR / "user-steps"

REPORTLAB_FONT_DIR = Path(__import__("reportlab").__file__).resolve().parent / "fonts"
pdfmetrics.registerFont(TTFont("BrixSans", str(REPORTLAB_FONT_DIR / "Vera.ttf")))
pdfmetrics.registerFont(TTFont("BrixSansBold", str(REPORTLAB_FONT_DIR / "VeraBd.ttf")))


PAGE = landscape(A4)
BG = colors.HexColor("#FBFBFD")
DARK = colors.HexColor("#1D1D1F")
TEXT = colors.HexColor("#1D1D1F")
MUTED = colors.HexColor("#6E6E73")
CYAN = colors.HexColor("#0DBBC8")
CYAN_DARK = colors.HexColor("#0A99A4")
LINE = colors.Color(0, 0, 0, alpha=0.08)

styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="DeckKicker",
        fontName="BrixSansBold",
        fontSize=9,
        leading=11,
        textColor=CYAN_DARK,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        name="DeckTitle",
        fontName="BrixSansBold",
        fontSize=25,
        leading=29,
        textColor=TEXT,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        name="DeckBody",
        fontName="BrixSans",
        fontSize=10,
        leading=14,
        textColor=MUTED,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverTitle",
        fontName="BrixSansBold",
        fontSize=35,
        leading=39,
        textColor=colors.white,
        spaceAfter=10,
    )
)
styles.add(
    ParagraphStyle(
        name="CoverBody",
        fontName="BrixSans",
        fontSize=13,
        leading=18,
        textColor=colors.Color(1, 1, 1, alpha=0.75),
    )
)


def p(text, style="DeckBody"):
    return Paragraph(text, styles[style])


def draw_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(DARK)
    canvas.rect(0, 0, PAGE[0], PAGE[1], stroke=0, fill=1)
    canvas.setFillColor(colors.Color(0.05, 0.65, 0.70, alpha=0.24))
    canvas.circle(PAGE[0] * 0.80, PAGE[1] * 0.82, 82 * mm, stroke=0, fill=1)
    canvas.setFillColor(CYAN)
    canvas.circle(22 * mm, PAGE[1] - 24 * mm, 3 * mm, stroke=0, fill=1)
    canvas.setFont("BrixSansBold", 14)
    canvas.setFillColor(colors.white)
    canvas.drawString(29 * mm, PAGE[1] - 27 * mm, "DepotOne")
    canvas.setFont("BrixSans", 8)
    canvas.setFillColor(colors.Color(1, 1, 1, alpha=0.68))
    canvas.drawString(29 * mm, PAGE[1] - 32 * mm, "by E.ON Drive · NEoT · Mitsui")
    canvas.setFont("BrixSans", 8.5)
    canvas.drawString(18 * mm, 14 * mm, "Mockup Overview · Stand: Juni 2026")
    canvas.restoreState()


def draw_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, PAGE[0], PAGE[1], stroke=0, fill=1)
    canvas.setStrokeColor(LINE)
    canvas.line(14 * mm, 12 * mm, PAGE[0] - 14 * mm, 12 * mm)
    canvas.setFont("BrixSans", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(14 * mm, 7 * mm, "Depot Readiness Check by DepotOne - Mockup Overview")
    canvas.drawRightString(PAGE[0] - 14 * mm, 7 * mm, str(doc.page))
    canvas.restoreState()


def screenshot_block(image_name, max_width=248 * mm, max_height=126 * mm):
    path = SCREEN_DIR / image_name
    img = FlowableImage(str(path))
    ratio = min(max_width / img.imageWidth, max_height / img.imageHeight)
    img.drawWidth = img.imageWidth * ratio
    img.drawHeight = img.imageHeight * ratio
    table = Table([[img]], colWidths=[max_width])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    return table


SCREENSHOT_PAGES = [
    ("1. Einstieg und Value Proposition", "Hero", "user-steps/01.png"),
    ("2. Schritt 1: Unternehmen", "Datenerfassung", "user-steps/02.png"),
    ("3. Schritt 2: Fuhrpark", "Datenerfassung", "user-steps/03.png"),
    ("4. Schritt 3: Einsatzprofil", "Datenerfassung", "user-steps/04.png"),
    ("5. Schritt 4: Depot und Infrastruktur", "Depotdaten", "user-steps/05.png"),
    ("6. Schritt 5: Laden und Energie", "Energiebedarf", "user-steps/06.png"),
    ("7. Schritt 6: Wirtschaftlichkeit und Timing", "Business Fit", "user-steps/07.png"),
    ("8. Schritt 7: Kontakt und Einwilligung", "Lead Capture", "user-steps/08.png"),
    ("9. Readiness Score", "Ergebnis", "user-steps/09.png"),
    ("10. DepotOne Plan-Empfehlung", "Plan-Logik", "user-steps/10.png"),
    ("11. Digital-Twin-Routenanalyse CTA", "Folgeschritt", "user-steps/11.png"),
]


def prepare_user_screenshots():
    LOCAL_USER_SCREEN_DIR.mkdir(parents=True, exist_ok=True)
    for index in range(1, 12):
        source = USER_SCREEN_DIR / f"{index}.png"
        if not source.exists():
            raise FileNotFoundError(f"Missing screenshot: {source}")
        target = LOCAL_USER_SCREEN_DIR / f"{index:02}.png"
        shutil.copy2(source, target)


def cover_story():
    return [
        Spacer(1, 57 * mm),
        Paragraph("Depot Readiness Check", styles["CoverTitle"]),
        Paragraph("Alle einzelnen Funnel-Schritte und Ergebnisbereiche", styles["CoverBody"]),
    ]


def page(title, subtitle, image_name):
    return [
        p(subtitle, "DeckKicker"),
        p(title, "DeckTitle"),
        Spacer(1, 4 * mm),
        screenshot_block(image_name),
    ]


def main():
    prepare_user_screenshots()
    doc = SimpleDocTemplate(
        str(OUT_FILE),
        pagesize=PAGE,
        rightMargin=14 * mm,
        leftMargin=14 * mm,
        topMargin=16 * mm,
        bottomMargin=16 * mm,
    )
    story = []
    story.extend(cover_story())
    for title, subtitle, image_name in SCREENSHOT_PAGES:
        story.append(PageBreak())
        story.extend(page(title, subtitle, image_name))
    doc.build(story, onFirstPage=draw_cover, onLaterPages=draw_page)
    print(OUT_FILE)


if __name__ == "__main__":
    main()

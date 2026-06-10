from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Flowable,
    Frame,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "output" / "pdf"
OUT_DIR.mkdir(parents=True, exist_ok=True)
OUT_FILE = OUT_DIR / "depot-readiness-check-overview.pdf"

REPORTLAB_FONT_DIR = Path(__import__("reportlab").__file__).resolve().parent / "fonts"
FONT_REGULAR = REPORTLAB_FONT_DIR / "Vera.ttf"
FONT_MEDIUM = REPORTLAB_FONT_DIR / "VeraBd.ttf"
FONT_BOLD = REPORTLAB_FONT_DIR / "VeraBd.ttf"

pdfmetrics.registerFont(TTFont("BrixSans", str(FONT_REGULAR)))
pdfmetrics.registerFont(TTFont("BrixSansMedium", str(FONT_MEDIUM)))
pdfmetrics.registerFont(TTFont("BrixSansBold", str(FONT_BOLD)))


BG = colors.HexColor("#FBFBFD")
DARK = colors.HexColor("#1D1D1F")
TEXT = colors.HexColor("#1D1D1F")
MUTED = colors.HexColor("#6E6E73")
CYAN = colors.HexColor("#0DBBC8")
CYAN_DARK = colors.HexColor("#0A99A4")
LINE = colors.Color(0, 0, 0, alpha=0.08)
SOFT = colors.HexColor("#F5F5F7")


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="Kicker",
        fontName="BrixSansBold",
        fontSize=8.5,
        leading=11,
        textColor=CYAN_DARK,
        uppercase=True,
        spaceAfter=7,
    )
)
styles.add(
    ParagraphStyle(
        name="TitleBig",
        fontName="BrixSansBold",
        fontSize=34,
        leading=37,
        textColor=colors.white,
        spaceAfter=12,
    )
)
styles.add(
    ParagraphStyle(
        name="DocTitle",
        fontName="BrixSansBold",
        fontSize=24,
        leading=28,
        textColor=TEXT,
        spaceAfter=10,
    )
)
styles.add(
    ParagraphStyle(
        name="SubTitle",
        fontName="BrixSansMedium",
        fontSize=14,
        leading=20,
        textColor=colors.Color(1, 1, 1, alpha=0.78),
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        name="DocBody",
        fontName="BrixSans",
        fontSize=10.5,
        leading=15,
        textColor=TEXT,
        spaceAfter=7,
    )
)
styles.add(
    ParagraphStyle(
        name="Muted",
        fontName="BrixSans",
        fontSize=9.2,
        leading=13,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        name="SmallWhite",
        fontName="BrixSans",
        fontSize=9.5,
        leading=13,
        textColor=colors.Color(1, 1, 1, alpha=0.72),
    )
)
styles.add(
    ParagraphStyle(
        name="CardTitle",
        fontName="BrixSansBold",
        fontSize=12,
        leading=15,
        textColor=TEXT,
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        name="CardText",
        fontName="BrixSans",
        fontSize=9.2,
        leading=13,
        textColor=MUTED,
    )
)
styles.add(
    ParagraphStyle(
        name="Footer",
        fontName="BrixSans",
        fontSize=8,
        leading=10,
        textColor=MUTED,
    )
)


class Background(Flowable):
    def __init__(self, color, width=0, height=0):
        super().__init__()
        self.color = color
        self.width = width
        self.height = height

    def draw(self):
        canvas = self.canv
        canvas.saveState()
        canvas.setFillColor(self.color)
        canvas.rect(0, 0, self.width, self.height, stroke=0, fill=1)
        canvas.restoreState()


def p(text, style="DocBody"):
    return Paragraph(text, styles[style])


def bullet(text):
    return Paragraph(f'<font color="#0A99A4">-</font> {text}', styles["DocBody"])


def card(title, body):
    return [
        p(title, "CardTitle"),
        p(body, "CardText"),
    ]


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(BG)
    canvas.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
    canvas.setStrokeColor(LINE)
    canvas.line(18 * mm, 18 * mm, A4[0] - 18 * mm, 18 * mm)
    canvas.setFont("BrixSans", 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 10.5 * mm, "Depot Readiness Check by DepotOne - Management Overview")
    canvas.drawRightString(A4[0] - 18 * mm, 10.5 * mm, str(doc.page))
    canvas.restoreState()


def draw_cover(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(DARK)
    canvas.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
    canvas.setFillColor(colors.Color(0.05, 0.65, 0.70, alpha=0.24))
    canvas.circle(A4[0] * 0.82, A4[1] * 0.82, 92 * mm, stroke=0, fill=1)
    canvas.setFillColor(CYAN)
    canvas.circle(28 * mm, A4[1] - 31 * mm, 3 * mm, stroke=0, fill=1)
    canvas.setFont("BrixSansBold", 15)
    canvas.setFillColor(colors.white)
    canvas.drawString(35 * mm, A4[1] - 35 * mm, "DepotOne")
    canvas.setFont("BrixSans", 8.5)
    canvas.setFillColor(colors.Color(1, 1, 1, alpha=0.68))
    canvas.drawString(35 * mm, A4[1] - 40 * mm, "by E.ON Drive · NEoT · Mitsui")
    canvas.setFont("BrixSans", 9)
    canvas.setFillColor(colors.Color(1, 1, 1, alpha=0.72))
    canvas.drawString(18 * mm, 18 * mm, "Stand: Juni 2026")
    canvas.restoreState()


def cover_story():
    story = []
    story.append(Spacer(1, 91 * mm))
    story.append(Paragraph("Depot Readiness Check", styles["TitleBig"]))
    story.append(
        Paragraph(
            "Mini Management Summary: Funktionen, Lead-Funnel und Digital-Twin-Erweiterung",
            styles["SubTitle"],
        )
    )
    chips = Table(
        [[p("Lead Qualification", "SmallWhite"), p("DepotOne Plan", "SmallWhite"), p("Digital Twin Teaser", "SmallWhite")]],
        colWidths=[42 * mm, 36 * mm, 43 * mm],
    )
    chips.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.Color(1, 1, 1, alpha=0.10)),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.Color(1, 1, 1, alpha=0.20)),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.Color(1, 1, 1, alpha=0.16)),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(Spacer(1, 8 * mm))
    story.append(chips)
    return story


def page_one():
    story = []
    story.append(p("Management Summary", "Kicker"))
    story.append(p("Was der DRC beantwortet", "DocTitle"))
    story.append(
        p(
            "Der Depot Readiness Check beantwortet die erste kritische Kundenfrage: "
            "Ist unser Depot mit unseren Routen, Standzeiten, Fahrzeugen und Netzvoraussetzungen "
            "bereit für E-Trucks - und welcher nächste Planungsschritt ist sinnvoll?",
            "DocBody",
        )
    )
    story.append(Spacer(1, 5 * mm))
    rows = [
        [
            card("Painpoint", "Unsicherheit vor teuren Infrastruktur- und Fahrzeugentscheidungen."),
            card("Antwort", "Ein indikatives Readiness-Ergebnis mit Score, Reifegrad und nächsten Schritten."),
        ],
        [
            card("Lead-Qualifizierung", "A-, B- und C-Lead-Klassen nach Score, Timing, Fuhrparkgröße und Consent."),
            card("DepotOne-Anschluss", "Das Ergebnis leitet in Feasibility Plan, Optimization Plan oder Grundlagen-Check."),
        ],
    ]
    table = Table(rows, colWidths=[78 * mm, 78 * mm], rowHeights=[34 * mm, 38 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 9 * mm))
    story.append(p("Kernnutzen", "Kicker"))
    story.append(bullet("Der Kunde erhält eine erste Orientierung ohne technisches Vorprojekt."))
    story.append(bullet("DepotOne erhält strukturierte Lead-Daten statt einer allgemeinen Kontaktanfrage."))
    story.append(bullet("Sales und Pre-Sales sehen, ob zuerst Machbarkeit, Optimierung oder Grundlagenarbeit nötig ist."))
    story.append(bullet("Der Digital-Twin-Ansatz wird als nächster wertvoller Beratungsschritt vorbereitet."))
    return story


def page_two():
    story = []
    story.append(p("Funktionaler Überblick", "Kicker"))
    story.append(p("Die Kernfunktionen des Checks", "DocTitle"))
    columns = [
        [
            p("1. Mehrstufiger Wizard", "CardTitle"),
            p("Erfasst Unternehmen, Fuhrpark, Einsatzprofil, Depot, Energie, Wirtschaftlichkeit und Consent.", "CardText"),
            Spacer(1, 5 * mm),
            p("2. Scoring Engine", "CardTitle"),
            p("Berechnet 0-100 Punkte über Fleet Potential, Operational Fit, Depot Infrastructure, Commercial Fit und Timing.", "CardText"),
        ],
        [
            p("3. Ergebnislogik", "CardTitle"),
            p("Zeigt Readiness-Level, Stärken, offene Punkte, Empfehlungen und einen klaren nächsten DepotOne-Schritt.", "CardText"),
            Spacer(1, 5 * mm),
            p("4. Lead-Funnel", "CardTitle"),
            p("Kontaktfreigabe, Marketing-Opt-in, Lead-Klasse und Export als JSON/CSV für Follow-up und CRM-Anbindung.", "CardText"),
        ],
    ]
    table = Table([columns], colWidths=[78 * mm, 78 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 12),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 10 * mm))
    story.append(p("DepotOne Plan-Logik", "Kicker"))
    plan_rows = [
        ["Kundensituation", "Empfohlener nächster Schritt"],
        ["Konkrete Daten, hohe Reife, hohes Timing", "Optimization Plan"],
        ["Mittlere Reife oder erste konkrete Depotdaten", "Feasibility Plan"],
        ["Frühe Orientierung, viele unbekannte Angaben", "Grundlagen-Check"],
    ]
    plan_table = Table(plan_rows, colWidths=[88 * mm, 68 * mm])
    plan_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), DARK),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "BrixSansBold"),
                ("FONTNAME", (0, 1), (-1, -1), "BrixSans"),
                ("FONTSIZE", (0, 0), (-1, -1), 9.2),
                ("LEADING", (0, 0), (-1, -1), 12),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.append(plan_table)
    return story


def page_three():
    story = []
    story.append(p("Digital Twin Erweiterung", "Kicker"))
    story.append(p("Wie der Routenzwilling funktionieren würde", "DocTitle"))
    story.append(
        p(
            "Der Digital Twin ist kein 3D-Modell, sondern ein Simulationsmodell aus Routen, Fahrzeugen, Ladefenstern, Energiebedarf "
            "und Depotkapazität. Er prüft vor der Investition, welche Touren elektrifizierbar sind und welche Ladeinfrastruktur sinnvoll ist.",
            "DocBody",
        )
    )
    flow_rows = [
        [
            card("Input", "Touren, Kilometer, Rückkehrzeit, Standzeit, Fahrzeugklasse, Beladung und Depotdaten."),
            card("Simulation", "Energiebedarf, Restakku, Ladezeit, gleichzeitige Ladevorgänge und Peak Power."),
            card("Output", "Route Fit, kritische Touren, Ladeplan, Charger-Bedarf und nächste Elektrifizierungswelle."),
        ]
    ]
    flow_table = Table(flow_rows, colWidths=[52 * mm, 52 * mm, 52 * mm], rowHeights=[54 * mm])
    flow_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    story.append(Spacer(1, 5 * mm))
    story.append(flow_table)
    story.append(Spacer(1, 10 * mm))
    story.append(p("Warum das für den Funnel stark ist", "Kicker"))
    story.append(bullet("Es macht den abstrakten Depot-Check zu einem konkreten Planungsangebot."))
    story.append(bullet("Es schafft eine natürliche Brücke vom Self-Service-Check zum qualifizierten Pre-Sales-Gespräch."))
    story.append(bullet("Es reduziert Investitionsangst, weil Routen und Ladebedarf vorab simuliert werden."))
    story.append(bullet("Es differenziert DepotOne gegenüber reinen Ladeinfrastruktur-Anbietern."))
    return story


def page_four():
    story = []
    story.append(p("Management Takeaway", "Kicker"))
    story.append(p("Warum der DRC strategisch sinnvoll ist", "DocTitle"))
    rows = [
        [
            p("1", "CardTitle"),
            p("Der DRC beantwortet eine echte Vorstandsfrage: Was ist unser nächster risikoarmer Schritt zur Depot-Elektrifizierung?", "DocBody"),
        ],
        [
            p("2", "CardTitle"),
            p("Er wandelt unscharfes Interesse in strukturierte Lead-Daten und priorisierbare Verkaufschancen.", "DocBody"),
        ],
        [
            p("3", "CardTitle"),
            p("Die neue Plan-Logik macht DepotOne als Berater und Orchestrator sichtbar, nicht nur als Anbieter von Ladepunkten.", "DocBody"),
        ],
        [
            p("4", "CardTitle"),
            p("Der Digital Twin ist die nächste Premium-Stufe: Routen simulieren, Ladebedarf optimieren, Investitionen vorbereiten.", "DocBody"),
        ],
    ]
    table = Table(rows, colWidths=[18 * mm, 138 * mm], rowHeights=[24 * mm, 27 * mm, 29 * mm, 29 * mm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("TEXTCOLOR", (0, 0), (0, -1), CYAN_DARK),
                ("ALIGN", (0, 0), (0, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    story.append(table)
    story.append(Spacer(1, 12 * mm))
    story.append(p("Empfohlene nächste Umsetzung", "Kicker"))
    story.append(
        p(
            "Als nächstes sollte der Check um ein schlankes Routenprofil-Modul erweitert werden. "
            "Damit kann der Ergebnisbereich einen ersten Route Fit, kritische Touren und einen Digital-Twin-CTA anzeigen.",
            "DocBody",
        )
    )
    story.append(Spacer(1, 8 * mm))
    callout = Table(
        [[p("Kurzform für Entscheider: Der DRC qualifiziert nicht nur Leads - er verkauft den nächsten sinnvollen Plan.", "CardTitle")]],
        colWidths=[156 * mm],
    )
    callout.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.Color(0.05, 0.74, 0.78, alpha=0.13)),
                ("BOX", (0, 0), (-1, -1), 0.6, colors.Color(0.05, 0.74, 0.78, alpha=0.35)),
                ("LEFTPADDING", (0, 0), (-1, -1), 13),
                ("RIGHTPADDING", (0, 0), (-1, -1), 13),
                ("TOPPADDING", (0, 0), (-1, -1), 11),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
            ]
        )
    )
    story.append(callout)
    return story


def main():
    doc = SimpleDocTemplate(
        str(OUT_FILE),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=24 * mm,
        bottomMargin=24 * mm,
    )
    story = []
    story.extend(cover_story())
    story.append(PageBreak())
    story.extend(page_one())
    story.append(PageBreak())
    story.extend(page_two())
    story.append(PageBreak())
    story.extend(page_three())
    story.append(PageBreak())
    story.extend(page_four())
    doc.build(story, onFirstPage=draw_cover, onLaterPages=draw_footer)
    print(OUT_FILE)


if __name__ == "__main__":
    main()

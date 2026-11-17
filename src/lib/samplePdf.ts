import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { sanitizeWinAnsi } from "./pdfEncoding";

/**
 * Creates a beautiful, multi-page (4-page) interactive Welcome & Feature Showcase PDF
 * designed for testing page surgery, annotations, AcroForm filling/flattening,
 * e-signatures, redactions, and rotations.
 */
export async function createSampleWelcomePdf(): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  // Set document metadata
  pdfDoc.setTitle("VibePDF Studio Interactive Showcase");
  pdfDoc.setAuthor("VibePDF Team");
  pdfDoc.setSubject("Feature Demonstration & Testing Suite");
  pdfDoc.setCreator("VibePDF Studio WebAssembly Engine");

  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // ==========================================
  // PAGE 1: Welcome & Annotation Testing
  // ==========================================
  const page1 = pdfDoc.addPage([595.28, 841.89]); // A4 Portrait
  const { width: p1W, height: p1H } = page1.getSize();

  // Header Banner
  page1.drawRectangle({
    x: 0,
    y: p1H - 120,
    width: p1W,
    height: 120,
    color: rgb(0.06, 0.07, 0.09), // #0f1217
  });

  page1.drawText("VibePDF Studio", {
    x: 50,
    y: p1H - 60,
    size: 26,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page1.drawText("High-Performance Offline-First PDF Architecture", {
    x: 50,
    y: p1H - 85,
    size: 13,
    font: helvetica,
    color: rgb(0.65, 0.7, 0.8),
  });

  // Badge
  page1.drawRectangle({
    x: p1W - 160,
    y: p1H - 75,
    width: 110,
    height: 24,
    color: rgb(0.38, 0.4, 0.95), // Indigo
  });
  page1.drawText("PWA & WASM", {
    x: p1W - 146,
    y: p1H - 67,
    size: 10,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  // Section 1: Overview
  let y = p1H - 160;
  page1.drawText("Welcome to Your New Document Workspace", {
    x: 50,
    y,
    size: 16,
    font: helveticaBold,
    color: rgb(0.12, 0.14, 0.18),
  });

  y -= 25;
  const introText = [
    "VibePDF Studio is an ultra-fast, client-side PDF viewer and page surgery suite built with",
    "pure WebAssembly and Web Workers. Your documents stay 100% private and never leave your",
    "browser unless you explicitly choose to synchronize them with your private cloud vault.",
  ];
  for (const line of introText) {
    page1.drawText(line, {
      x: 50,
      y,
      size: 10.5,
      font: helvetica,
      color: rgb(0.25, 0.28, 0.35),
    });
    y -= 16;
  }

  // Section 2: Annotation Playground
  y -= 25;
  page1.drawRectangle({
    x: 50,
    y: y - 170,
    width: p1W - 100,
    height: 180,
    color: rgb(0.97, 0.98, 1),
    borderColor: rgb(0.85, 0.88, 0.95),
    borderWidth: 1,
  });

  page1.drawText("ANNOTATION & REDACTION TEST BENCH", {
    x: 70,
    y: y - 20,
    size: 11,
    font: helveticaBold,
    color: rgb(0.28, 0.35, 0.65),
  });

  page1.drawText("Try out your annotation tools on the sample text below:", {
    x: 70,
    y: y - 40,
    size: 10,
    font: helveticaOblique,
    color: rgb(0.4, 0.45, 0.55),
  });

  const testLines = [
    "1. Highlight Tool: Select this sentence to apply a soft translucent yellow marker.",
    "2. Underline & Strikeout: Test semantic markup on this critical compliance statement.",
    "3. Redaction Tool: Draw an opaque black mask over confidential data: [CONFIDENTIAL-SSN-9982].",
    "4. Sticky Notes: Drop a persistent comment bubble right here for reviewer feedback.",
    "5. Freehand Ink: Sketch or circle this section using your stylus or mouse cursor.",
  ];

  let sampleY = y - 65;
  for (const line of testLines) {
    page1.drawText(line, {
      x: 70,
      y: sampleY,
      size: 9.5,
      font: helvetica,
      color: rgb(0.15, 0.18, 0.22),
    });
    sampleY -= 20;
  }

  // Key Features Bullet Grid
  y = sampleY - 40;
  page1.drawText("Core System Capabilities", {
    x: 50,
    y,
    size: 14,
    font: helveticaBold,
    color: rgb(0.12, 0.14, 0.18),
  });

  y -= 25;
  const features = [
    "• High-DPI PDFium WebAssembly Viewport with buttery smooth zoom and search.",
    "• Multithreaded Page Surgery: Reorder, rotate 90/180°, delete, split, and merge.",
    "• Interactive AcroForm filling and permanent vector flattening.",
    "• E-Signature Studio: Draw with ink physics or generate crisp calligraphic seals.",
    "• Offline IndexedDB caching with optional real-time Convex cloud synchronization.",
  ];

  for (const feat of features) {
    page1.drawText(feat, {
      x: 50,
      y,
      size: 10,
      font: helvetica,
      color: rgb(0.3, 0.35, 0.4),
    });
    y -= 18;
  }

  // Page Footer
  page1.drawText("Page 1 of 4  •  VibePDF Studio Feature Showcase", {
    x: 50,
    y: 35,
    size: 9,
    font: helvetica,
    color: rgb(0.6, 0.65, 0.7),
  });

  // ==========================================
  // PAGE 2: Interactive AcroForms
  // ==========================================
  const page2 = pdfDoc.addPage([595.28, 841.89]);
  const { width: p2W, height: p2H } = page2.getSize();

  // Page 2 Header
  page2.drawRectangle({
    x: 0,
    y: p2H - 80,
    width: p2W,
    height: 80,
    color: rgb(0.12, 0.15, 0.2),
  });

  page2.drawText("Interactive AcroForm Demonstration", {
    x: 50,
    y: p2H - 45,
    size: 18,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page2.drawText("Fill out the interactive form fields below, then click 'Flatten Document' to burn them in permanently.", {
    x: 50,
    y: p2H - 65,
    size: 10,
    font: helvetica,
    color: rgb(0.7, 0.75, 0.85),
  });

  const form = pdfDoc.getForm();

  let formY = p2H - 130;

  // Field 1: Full Name
  page2.drawText("Full Name / Signer Name:", {
    x: 50,
    y: formY + 4,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.3),
  });
  const nameField = form.createTextField("applicant.fullName");
  nameField.setText("Jordan Sterling");
  nameField.addToPage(page2, {
    x: 220,
    y: formY - 6,
    width: 300,
    height: 24,
    borderWidth: 1,
    borderColor: rgb(0.7, 0.75, 0.85),
    backgroundColor: rgb(0.98, 0.99, 1),
  });

  formY -= 45;
  // Field 2: Organization / Company
  page2.drawText("Company or Organization:", {
    x: 50,
    y: formY + 4,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.3),
  });
  const companyField = form.createTextField("applicant.company");
  companyField.setText("Vibe Technologies Global Inc.");
  companyField.addToPage(page2, {
    x: 220,
    y: formY - 6,
    width: 300,
    height: 24,
    borderWidth: 1,
    borderColor: rgb(0.7, 0.75, 0.85),
    backgroundColor: rgb(0.98, 0.99, 1),
  });

  formY -= 45;
  // Field 3: Email Address
  page2.drawText("Email Address:", {
    x: 50,
    y: formY + 4,
    size: 10,
    font: helveticaBold,
    color: rgb(0.2, 0.25, 0.3),
  });
  const emailField = form.createTextField("applicant.email");
  emailField.setText("jordan.sterling@example.com");
  emailField.addToPage(page2, {
    x: 220,
    y: formY - 6,
    width: 300,
    height: 24,
    borderWidth: 1,
    borderColor: rgb(0.7, 0.75, 0.85),
    backgroundColor: rgb(0.98, 0.99, 1),
  });

  formY -= 50;
  // Checkbox 1: Terms Agreement
  const cbTerms = form.createCheckBox("applicant.termsAgreed");
  cbTerms.check();
  cbTerms.addToPage(page2, {
    x: 50,
    y: formY,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.5, 0.55, 0.7),
  });
  page2.drawText("I verify that all information provided in this form is accurate and complete.", {
    x: 80,
    y: formY + 4,
    size: 10,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.3),
  });

  formY -= 30;
  // Checkbox 2: Cloud Sync
  const cbCloud = form.createCheckBox("applicant.enableSync");
  cbCloud.check();
  cbCloud.addToPage(page2, {
    x: 50,
    y: formY,
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: rgb(0.5, 0.55, 0.7),
  });
  page2.drawText("Enable encrypted local IndexedDB storage and optional Convex cloud backup.", {
    x: 80,
    y: formY + 4,
    size: 10,
    font: helvetica,
    color: rgb(0.2, 0.25, 0.3),
  });

  // Additional instructions card
  formY -= 60;
  page2.drawRectangle({
    x: 50,
    y: formY - 140,
    width: p2W - 100,
    height: 150,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.95),
    borderWidth: 1,
  });

  page2.drawText("ACROFORM FLATTENING VERIFICATION", {
    x: 70,
    y: formY - 20,
    size: 11,
    font: helveticaBold,
    color: rgb(0.2, 0.45, 0.35),
  });

  const formHelp = [
    "When a document contains interactive forms, other PDF viewers or print services may lose",
    "the entered data if the fields remain uncommitted. VibePDF Studio's 'Flatten Document' tool",
    "bakes the form values directly into the PDF's vector stream so they render identically across",
    "every mobile phone, desktop operating system, and hardware printer worldwide.",
  ];

  let helpY = formY - 45;
  for (const line of formHelp) {
    page2.drawText(line, {
      x: 70,
      y: helpY,
      size: 9.5,
      font: helvetica,
      color: rgb(0.3, 0.35, 0.4),
    });
    helpY -= 18;
  }

  // Page Footer
  page2.drawText("Page 2 of 4  •  AcroForm Interactive Components", {
    x: 50,
    y: 35,
    size: 9,
    font: helvetica,
    color: rgb(0.6, 0.65, 0.7),
  });

  // ==========================================
  // PAGE 3: Official Document & E-Signature
  // ==========================================
  const page3 = pdfDoc.addPage([595.28, 841.89]);
  const { width: p3W, height: p3H } = page3.getSize();

  // Page 3 Header
  page3.drawRectangle({
    x: 0,
    y: p3H - 80,
    width: p3W,
    height: 80,
    color: rgb(0.15, 0.12, 0.22),
  });

  page3.drawText("Official Execution & E-Signature Zone", {
    x: 50,
    y: p3H - 45,
    size: 18,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page3.drawText("Use the E-Sign Studio to draw or generate your signature, then stamp it into the designated box.", {
    x: 50,
    y: p3H - 65,
    size: 10,
    font: helvetica,
    color: rgb(0.8, 0.75, 0.9),
  });

  let sigY = p3H - 120;
  page3.drawText("Executive Summary of Terms", {
    x: 50,
    y: sigY,
    size: 13,
    font: helveticaBold,
    color: rgb(0.15, 0.15, 0.2),
  });

  sigY -= 20;
  const legalTerms = [
    "By affixing an electronic stamp or handwritten signature below, both parties acknowledge and",
    "agree to the offline execution provisions of this document. Digital signatures placed via VibePDF",
    "Studio are embedded as high-fidelity PNG raster images or vector curves directly in the PDF stream.",
  ];

  for (const line of legalTerms) {
    page3.drawText(line, {
      x: 50,
      y: sigY,
      size: 9.5,
      font: helvetica,
      color: rgb(0.3, 0.35, 0.4),
    });
    sigY -= 16;
  }

  // Signature Target Box
  sigY -= 40;
  page3.drawRectangle({
    x: 50,
    y: sigY - 140,
    width: p3W - 100,
    height: 150,
    color: rgb(0.99, 0.99, 1),
    borderColor: rgb(0.5, 0.45, 0.8),
    borderWidth: 1.5,
  });

  page3.drawText("AUTHORIZED SIGNATURE BOX (STAMP HERE)", {
    x: 70,
    y: sigY - 20,
    size: 10,
    font: helveticaBold,
    color: rgb(0.4, 0.35, 0.7),
  });

  // Signature Line
  page3.drawLine({
    start: { x: 70, y: sigY - 95 },
    end: { x: 340, y: sigY - 95 },
    thickness: 1,
    color: rgb(0.6, 0.6, 0.7),
  });

  page3.drawText("Signer Signature (Draw or Type via E-Sign modal)", {
    x: 70,
    y: sigY - 110,
    size: 8.5,
    font: helveticaOblique,
    color: rgb(0.5, 0.5, 0.6),
  });

  // Date Line
  page3.drawLine({
    start: { x: 370, y: sigY - 95 },
    end: { x: 500, y: sigY - 95 },
    thickness: 1,
    color: rgb(0.6, 0.6, 0.7),
  });

  page3.drawText("Date (YYYY-MM-DD)", {
    x: 370,
    y: sigY - 110,
    size: 8.5,
    font: helveticaOblique,
    color: rgb(0.5, 0.5, 0.6),
  });

  // Official Seal Placeholder
  page3.drawRectangle({
    x: 50,
    y: sigY - 270,
    width: 220,
    height: 100,
    color: rgb(0.97, 0.98, 0.99),
    borderColor: rgb(0.8, 0.85, 0.9),
    borderWidth: 1,
  });
  page3.drawText("VERIFIED AUDIT HASH", {
    x: 65,
    y: sigY - 190,
    size: 9,
    font: helveticaBold,
    color: rgb(0.3, 0.4, 0.5),
  });
  page3.drawText("SHA-256: e3b0c44298fc1c149afb", {
    x: 65,
    y: sigY - 210,
    size: 8,
    font: helvetica,
    color: rgb(0.4, 0.5, 0.6),
  });
  page3.drawText("Timestamp: Instant Web Worker Hash", {
    x: 65,
    y: sigY - 225,
    size: 8,
    font: helvetica,
    color: rgb(0.4, 0.5, 0.6),
  });

  // Page Footer
  page3.drawText("Page 3 of 4  •  E-Signature & Document Authentication", {
    x: 50,
    y: 35,
    size: 9,
    font: helvetica,
    color: rgb(0.6, 0.65, 0.7),
  });

  // ==========================================
  // PAGE 4: Page Surgery & Extraction Test
  // ==========================================
  // Give page 4 a distinct landscape-like size or clear visual markers to test rotation
  const page4 = pdfDoc.addPage([595.28, 841.89]);
  const { width: p4W, height: p4H } = page4.getSize();

  // Page 4 Header
  page4.drawRectangle({
    x: 0,
    y: p4H - 80,
    width: p4W,
    height: 80,
    color: rgb(0.2, 0.12, 0.12), // Deep Burgundy
  });

  page4.drawText("Page Surgery, Rotation & Extraction Target", {
    x: 50,
    y: p4H - 45,
    size: 18,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });

  page4.drawText("Open the 'Page Surgery' modal to drag & drop reorder, rotate 90° CW/CCW, or extract this page.", {
    x: 50,
    y: p4H - 65,
    size: 10,
    font: helvetica,
    color: rgb(0.9, 0.75, 0.75),
  });

  let surgeryY = p4H - 120;
  page4.drawText("Test Scenarios for Page Operations", {
    x: 50,
    y: surgeryY,
    size: 13,
    font: helveticaBold,
    color: rgb(0.2, 0.1, 0.1),
  });

  surgeryY -= 25;
  const surgeryTests = [
    "1. Drag-and-Drop Reorder: In the Page Surgery modal, drag Page 4 to become Page 1.",
    "2. Individual Page Rotation: Click the Rotate 90° CW button to turn this page sideways.",
    "3. Multi-Page Extraction: Select Page 2 and Page 4, then click 'Extract Pages' to create a new draft.",
    "4. PDF Merge: Pick another PDF file from your computer and append it to this document.",
    "5. Page Deletion: Select any unwanted page and click Delete (with safety checks).",
  ];

  for (const item of surgeryTests) {
    page4.drawText(item, {
      x: 50,
      y: surgeryY,
      size: 10,
      font: helvetica,
      color: rgb(0.25, 0.25, 0.3),
    });
    surgeryY -= 20;
  }

  // Visual Matrix Grid (makes rotation obvious!)
  surgeryY -= 30;
  page4.drawRectangle({
    x: 50,
    y: surgeryY - 200,
    width: p4W - 100,
    height: 210,
    color: rgb(0.99, 0.97, 0.97),
    borderColor: rgb(0.85, 0.7, 0.7),
    borderWidth: 1,
  });

  page4.drawText("ORIENTATION & ROTATION VISUAL ALIGNMENT GRID", {
    x: 70,
    y: surgeryY - 20,
    size: 10,
    font: helveticaBold,
    color: rgb(0.6, 0.2, 0.2),
  });

  // Cross-hair center indicator
  const gridCenterX = p4W / 2;
  const gridCenterY = surgeryY - 110;

  page4.drawLine({
    start: { x: gridCenterX - 100, y: gridCenterY },
    end: { x: gridCenterX + 100, y: gridCenterY },
    thickness: 1.5,
    color: rgb(0.8, 0.4, 0.4),
  });

  page4.drawLine({
    start: { x: gridCenterX, y: gridCenterY - 60 },
    end: { x: gridCenterX, y: gridCenterY + 60 },
    thickness: 1.5,
    color: rgb(0.8, 0.4, 0.4),
  });

  // Vector arrow head pointing UP
  page4.drawLine({
    start: { x: gridCenterX - 6, y: gridCenterY + 52 },
    end: { x: gridCenterX, y: gridCenterY + 60 },
    thickness: 1.5,
    color: rgb(0.8, 0.4, 0.4),
  });
  page4.drawLine({
    start: { x: gridCenterX + 6, y: gridCenterY + 52 },
    end: { x: gridCenterX, y: gridCenterY + 60 },
    thickness: 1.5,
    color: rgb(0.8, 0.4, 0.4),
  });

  // Vector arrow head pointing RIGHT
  page4.drawLine({
    start: { x: gridCenterX + 92, y: gridCenterY + 6 },
    end: { x: gridCenterX + 100, y: gridCenterY },
    thickness: 1.5,
    color: rgb(0.8, 0.4, 0.4),
  });
  page4.drawLine({
    start: { x: gridCenterX + 92, y: gridCenterY - 6 },
    end: { x: gridCenterX + 100, y: gridCenterY },
    thickness: 1.5,
    color: rgb(0.8, 0.4, 0.4),
  });

  page4.drawText(sanitizeWinAnsi("TOP (0 DEG)"), {
    x: gridCenterX - 30,
    y: gridCenterY + 70,
    size: 9,
    font: helveticaBold,
    color: rgb(0.7, 0.2, 0.2),
  });

  page4.drawText(sanitizeWinAnsi("RIGHT (90 DEG CW)"), {
    x: gridCenterX + 108,
    y: gridCenterY - 4,
    size: 8,
    font: helveticaBold,
    color: rgb(0.7, 0.2, 0.2),
  });

  // Page Footer
  page4.drawText("Page 4 of 4  •  Page Surgery & Multi-Page Extraction Target", {
    x: 50,
    y: 35,
    size: 9,
    font: helvetica,
    color: rgb(0.6, 0.65, 0.7),
  });

  // Save the full document to an ArrayBuffer
  const pdfBytes = await pdfDoc.save();
  const copy = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  return new Blob([copy], { type: "application/pdf" });
}

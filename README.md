# ASIP_176: Smart Medical Assistant
### [cite_start]Voice-First Medicine Identifier for Indian Health Workers [cite: 1]

## 📌 Problem Statement
[cite_start]Many frontline health workers (like ASHA workers) in rural or semi-urban areas face challenges in reading or typing complex medicine names on prescription bottles[cite: 1, 40]. [cite_start]This app is designed to bridge that gap by eliminating the need to read or type entirely, ensuring safe and accurate medicine administration[cite: 3].

## 💡 Solution
[cite_start]ASIP_176 is a voice-first web application[cite: 1]. [cite_start]A health worker simply holds a medicine bottle up to their device's camera and captures an image[cite: 2, 3]. [cite_start]The app automatically reads the medicine text using on-device optical character recognition (OCR), cross-references it with a local medicine database using a fuzzy-matching safety layer, and verbally communicates the correct dosage and warnings aloud[cite: 3, 21, 30].

---

## 🛠️ Tech Stack
* [cite_start]**Frontend:** HTML5 & Vanilla JavaScript (Zero setup, runs instantly in any browser) [cite: 7]
* [cite_start]**Local Server:** VS Code Live Server Extension [cite: 7]
* [cite_start]**OCR Engine:** Tesseract.js (Loaded via CDN) [cite: 7]
* [cite_start]**Voice Synthesis:** Web Speech API (Native browser text-to-speech) [cite: 7]
* [cite_start]**Database:** Local JSON file (`medicines.json`) [cite: 7]

---

## 📂 Project Structure
```text
asip176/
├── index.html       # Main user interface (buttons, video stream, and result display)
├── app.js           # Core logic (camera control, OCR processing, database lookup, and audio)
└── medicines.json   # Local dataset containing medicine names, dosages, and warnings
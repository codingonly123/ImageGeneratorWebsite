import { useState, useRef } from "react";
import TextareaAutosize from "react-textarea-autosize";
import "./App.css";

// Helper: Convert base64 Data URL to a File for the OpenAI image edit API
function base64ToFile(base64Data, filename = "poster.png") {
  const parts = base64Data.split(",");
  const mime =
    parts.length > 1
      ? parts[0].match(/:(.*?);/)?.[1] || "image/png"
      : "image/png";
  const base64Str = parts.length > 1 ? parts[1] : parts[0];
  const binaryStr = atob(base64Str);
  const len = binaryStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}

function App() {
  const [prompt, setPrompt] = useState("");
  const [imageUrl, setImageUrl] = useState(null);
  const [translationInfo, setTranslationInfo] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [uploadedPreview, setUploadedPreview] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);

  // Handle local image upload by user to update/redesign
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFile(file);
      const reader = new FileReader();
      reader.onload = () => setUploadedPreview(reader.result);
      reader.readAsDataURL(file);
      // If user uploaded an image, reset previous generation
      setImageUrl(null);
      setError(null);
    }
  };

  const handleClearImage = () => {
    setImageUrl(null);
    setUploadedFile(null);
    setUploadedPreview(null);
    setTranslationInfo(null);
    setPrompt("");
    setError(null);
  };

  const handleDownload = () => {
    const targetUrl = imageUrl || uploadedPreview;
    if (!targetUrl) return;
    const a = document.createElement("a");
    a.href = targetUrl;
    a.download = `islamic-poster-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // Main generator / modifier function
  const handleGenerateOrUpdate = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && !uploadedFile) return;

    setIsLoading(true);
    setError(null);

    try {
      const activeImage = imageUrl || uploadedPreview;
      const isRedesignOrUpdate = Boolean(activeImage);

      // STEP 1: Translate Arabic text to English and prepare prompt for ChatGPT Image API
      setStatusMessage(
        isRedesignOrUpdate
          ? "Translating & preparing redesign instructions..."
          : "Translating Arabic & formatting Islamic poster prompt...",
      );

      const systemInstruction = isRedesignOrUpdate
        ? `You are an AI assistant preparing an edit prompt for an Islamic poster designed for Facebook and WhatsApp status.
The user is updating or redesigning an existing poster.
Previous text if any: Arabic "${translationInfo?.arabicText || ""}", English: "${translationInfo?.englishTranslation || ""}".
User redesign request: "${trimmedPrompt}".
Detect any Arabic in the user's request, translate it to English, and produce a clear edit instruction in English.
Make sure the poster maintains beautiful Islamic calligraphy and its English translation in the design for Facebook and WhatsApp status.
Output a JSON object with:
{
  "arabicText": "extracted Arabic text or empty string",
  "englishTranslation": "English translation or empty string",
  "finalImagePrompt": "detailed prompt for the image edit API describing how to update specific parts or redesign the poster"
}`
        : `You are an AI assistant that prepares prompts for generating aesthetic Islamic posters for Facebook and WhatsApp status.
The user input is: "${trimmedPrompt}".
1. Extract any Arabic sentence, verse, hadith, or dua.
2. Translate the Arabic sentence to clear and eloquent English.
3. Construct a high-quality prompt for gpt-image-2 to create an aesthetic Islamic poster for Facebook and WhatsApp status.
The prompt MUST explicitly ask to include the Arabic text with beautiful Arabic calligraphy, AND include the English translation written gracefully alongside it in the design, with elegant Islamic aesthetic, geometric patterns, and balanced layout.
Output a JSON object:
{
  "arabicText": "the Arabic sentence",
  "englishTranslation": "the English translation",
  "finalImagePrompt": "the full prompt for gpt-image-2"
}`;

      const chatRes = await fetch("/api/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content:
                trimmedPrompt ||
                "Redesign and enhance this Islamic poster for WhatsApp and Facebook status",
            },
          ],
        }),
      });

      if (!chatRes.ok) {
        const errData = await chatRes.json().catch(() => ({}));
        throw new Error(
          errData.error?.message || "Failed to process translation",
        );
      }

      const chatData = await chatRes.json();
      const parsed = JSON.parse(chatData.choices[0].message.content);

      if (parsed.arabicText || parsed.englishTranslation) {
        setTranslationInfo({
          arabicText: parsed.arabicText || translationInfo?.arabicText,
          englishTranslation:
            parsed.englishTranslation || translationInfo?.englishTranslation,
        });
      }

      const finalPrompt = parsed.finalImagePrompt || trimmedPrompt;

      // STEP 2: Call Image API (Edits if updating an image, Generations if from scratch)
      setStatusMessage(
        isRedesignOrUpdate
          ? "Updating poster design with gpt-image-2..."
          : "Generating Islamic poster with gpt-image-2...",
      );

      let imageRes;

      if (isRedesignOrUpdate) {
        // Use v1/images/edits
        const formData = new FormData();
        formData.append("model", "gpt-image-2");
        formData.append("prompt", finalPrompt);
        formData.append("n", "1");
        formData.append("size", "1024x1024");

        if (uploadedFile) {
          formData.append("image[]", uploadedFile);
        } else if (imageUrl) {
          const fileFromBase64 = base64ToFile(imageUrl, "current-poster.png");
          formData.append("image[]", fileFromBase64);
        }

        imageRes = await fetch("/api/openai/v1/images/edits", {
          method: "POST",
          body: formData,
        });
      } else {
        // Use v1/images/generations
        imageRes = await fetch("/api/openai/v1/images/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-image-2",
            prompt: finalPrompt,
            n: 1,
            size: "1024x1024",
          }),
        });
      }

      if (!imageRes.ok) {
        const errData = await imageRes.json().catch(() => ({}));
        throw new Error(errData.error?.message || "Failed to generate image");
      }

      const imgData = await imageRes.json();
      const b64 = imgData.data?.[0]?.b64_json;
      if (!b64) throw new Error("No image data returned from API");

      setImageUrl(`data:image/png;base64,${b64}`);
      setUploadedFile(null);
      setUploadedPreview(null);
      setPrompt(""); // Clear input so user can type the next update instruction
    } catch (err) {
      console.error(err);
      setError(err.message || "An error occurred while generating the poster.");
    } finally {
      setIsLoading(false);
      setStatusMessage("");
    }
  };

  const hasImage = Boolean(imageUrl || uploadedPreview);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 20px",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <h1
        style={{
          fontFamily: "sans-serif",
          fontSize: "32px",
          fontWeight: 700,
          marginBottom: "8px",
          textAlign: "center",
        }}
      >
        Islamic Poster Generator
      </h1>
      <p
        style={{
          fontFamily: "sans-serif",
          color: "#666",
          fontSize: "15px",
          marginBottom: "64px",
          textAlign: "center",
        }}
      >
        Create aesthetic posters for Facebook & WhatsApp status with Arabic
        calligraphy and English translation
      </p>

      {/* SHOW GENERATED OR UPLOADED IMAGE ON TOP OF THE INPUT */}
      {hasImage && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginBottom: "28px",
            width: "100%",
            maxWidth: "600px",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              borderRadius: "16px",
              overflow: "hidden",
              boxShadow: "0 12px 30px rgba(0, 0, 0, 0.15)",
              backgroundColor: "#000",
            }}
          >
            <img
              src={imageUrl || uploadedPreview}
              alt="Islamic Poster"
              style={{
                width: "100%",
                height: "auto",
                display: "block",
                objectFit: "contain",
              }}
            />
          </div>

          {/* Action buttons directly beneath the image */}
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginTop: "14px",
              alignItems: "center",
            }}
          >
            <button
              onClick={handleDownload}
              style={{
                padding: "10px 20px",
                backgroundColor: "#0070f3",
                color: "white",
                border: "none",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ⬇ Download Poster
            </button>
            <button
              onClick={handleClearImage}
              style={{
                padding: "10px 16px",
                backgroundColor: "#f5f5f5",
                color: "#555",
                border: "1px solid #ddd",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              ✕ Start New
            </button>
          </div>

          {/* Translation details if available */}
          {translationInfo && (
            <div
              style={{
                marginTop: "12px",
                padding: "10px 16px",
                backgroundColor: "#f9f9fb",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#444",
                fontFamily: "sans-serif",
                textAlign: "center",
                maxWidth: "500px",
                border: "1px solid #eee",
              }}
            >
              {translationInfo.arabicText && (
                <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                  {translationInfo.arabicText}
                </div>
              )}
              {translationInfo.englishTranslation && (
                <div style={{ color: "#666", fontStyle: "italic" }}>
                  "{translationInfo.englishTranslation}"
                </div>
              )}
            </div>
          )}

          <div
            style={{
              marginTop: "8px",
              fontSize: "13px",
              color: "#888",
              fontFamily: "sans-serif",
            }}
          >
            💡 You can modify or update specific parts below with another
            prompt!
          </div>
        </div>
      )}

      {/* Hidden file input for uploading images */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="image/png, image/jpeg, image/webp"
        style={{ display: "none" }}
      />

      {/* Option to upload an image */}
      <div
        style={{
          width: "min(800px, 92vw)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
          fontSize: "14px",
          fontFamily: "sans-serif",
        }}
      >
        <span style={{ color: "#666" }}>
          {hasImage
            ? "Modify or redesign this poster:"
            : "Enter text to create from scratch, or:"}
        </span>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: "transparent",
            border: "none",
            color: "#0070f3",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          {uploadedFile ? "Replace uploaded image" : "+ Upload image"}
        </button>
      </div>

      {/* THE PROMPT INPUT */}
      <TextareaAutosize
        minRows={1}
        maxRows={6}
        style={{
          width: "min(800px, 92vw)",
          resize: "none",
          padding: "16px 22px",
          borderRadius: "9999px",
          fontFamily: "sans-serif",
          fontSize: "16px",
          marginBottom: "20px",
          border: "1px solid #d1d5db",
          outline: "none",
          boxSizing: "border-box",
          boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
        }}
        placeholder={
          hasImage
            ? "Ask to update a specific part or redesign it..."
            : "Enter English or Arabic text..."
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleGenerateOrUpdate();
          }
        }}
      />

      <button
        style={{
          padding: "18px 32px",
          border: "none",
          background: "black",
          color: "white",
          width: "min(400px, 92vw)",
          borderRadius: "12px",
          fontSize: "18px",
          fontWeight: 600,
          cursor: isLoading ? "not-allowed" : "pointer",
          opacity: isLoading ? 0.7 : 1,
          transition: "opacity 0.3s ease",
          boxShadow: "0 4px 14px rgba(0,0,0,0.15)",
        }}
        className="generate-button"
        onClick={handleGenerateOrUpdate}
        disabled={isLoading || (!prompt.trim() && !uploadedFile)}
      >
        {isLoading
          ? statusMessage || "Generating..."
          : hasImage
            ? "Update / Redesign Poster"
            : "Generate"}
      </button>

      {error && (
        <div
          style={{
            marginTop: "16px",
            color: "#e11d48",
            fontSize: "14px",
            fontFamily: "sans-serif",
            maxWidth: "600px",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

export default App;

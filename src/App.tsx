"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { unzipSync } from "fflate";

type PresetSizeKey =
  | "portrait"
  | "square"
  | "landscape"
  | "phonePortrait"
  | "phoneLandscape"
  | "tall"
  | "wide"
  | "smallPortrait"
  | "smallSquare"
  | "smallLandscape";

type SizeKey = PresetSizeKey | "custom";

type ArtistPreset = {
  id: string;
  name: string;
  value: string;
};

type VibeItem = {
  id: string;
  source: "image" | "json";
  name: string;
  file?: File;
  preview?: string;
  strength: number;
  information: number;
  encoding?: string;
  encodingKey?: string;
};

type ResultItem = { url: string; blob: Blob; index: number };

type GalleryItem = {
  id: string;
  prompt: string;
  artistString: string;
  seed: string;
  width: number;
  height: number;
  createdAt: string;
  imageUrl: string;
};

type GalleryRecord = Omit<GalleryItem, "imageUrl"> & { blob: Blob };

const sizes: Record<PresetSizeKey, { width: number; height: number; label: string; hint: string }> = {
  smallPortrait: { width: 512, height: 768, label: "不限额小竖图", hint: "512 × 768 · Opus" },
  smallSquare: { width: 640, height: 640, label: "不限额小方图", hint: "640 × 640 · Opus" },
  smallLandscape: { width: 768, height: 512, label: "不限额小横图", hint: "768 × 512 · Opus" },
  portrait: { width: 832, height: 1216, label: "标准竖图", hint: "832 × 1216" },
  square: { width: 1024, height: 1024, label: "正方形", hint: "1024 × 1024" },
  landscape: { width: 1216, height: 832, label: "标准横图", hint: "1216 × 832" },
  phonePortrait: { width: 768, height: 1344, label: "手机竖屏", hint: "768 × 1344" },
  phoneLandscape: { width: 1344, height: 768, label: "宽屏横图", hint: "1344 × 768" },
  tall: { width: 704, height: 1408, label: "超长竖图", hint: "704 × 1408" },
  wide: { width: 1408, height: 704, label: "超宽横图", hint: "1408 × 704" },
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeDimension(value: number) {
  return Math.round(clampNumber(value, 512, 256, 2048) / 64) * 64;
}

function prepareBrandLogo(file: File) {
  return new Promise<string>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(source);
        reject(new Error("当前浏览器无法处理这张图片。"));
        return;
      }
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      const left = (image.naturalWidth - side) / 2;
      const top = (image.naturalHeight - side) / 2;
      canvas.width = 256;
      canvas.height = 256;
      context.drawImage(image, left, top, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(source);
      resolve(canvas.toDataURL("image/webp", 0.9));
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("图片读取失败，请换一张 PNG、JPG 或 WebP。"));
    };
    image.src = source;
  });
}

function cleanEncoding(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^data:[^;]+;base64,/, "");
}

function parseVibeJson(data: unknown, fileName: string) {
  if (!data || typeof data !== "object") throw new Error(`${fileName} 不是有效的 Vibe JSON。`);
  const root = data as Record<string, unknown>;
  const parameterSource =
    root.parameters && typeof root.parameters === "object"
      ? (root.parameters as Record<string, unknown>)
      : root;
  const arrayEncodings =
    parameterSource.reference_image_multiple ??
    parameterSource.encodings ??
    parameterSource.vibe_encodings;

  if (Array.isArray(arrayEncodings)) {
    const strengths = parameterSource.reference_strength_multiple;
    const information = parameterSource.reference_information_extracted_multiple;
    return arrayEncodings
      .map((encoding, index) => ({
        encoding: cleanEncoding(encoding),
        name: `${fileName.replace(/\.json$/i, "")} ${index + 1}`,
        strength: clampNumber(Array.isArray(strengths) ? strengths[index] : undefined, 0.6, 0, 1),
        information: clampNumber(Array.isArray(information) ? information[index] : undefined, 1, 0.1, 1),
      }))
      .filter((item) => item.encoding);
  }

  const candidates = Array.isArray(root.vibes)
    ? root.vibes
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(data)
        ? data
        : [root.vibe && typeof root.vibe === "object" ? root.vibe : root];

  return candidates
    .map((candidate, index) => {
      if (!candidate || typeof candidate !== "object") return null;
      const item = candidate as Record<string, unknown>;
      const encoding = cleanEncoding(
        item.encoding ?? item.vibe_encoding ?? item.reference_image ?? item.referenceImage,
      );
      if (!encoding) return null;
      return {
        encoding,
        name:
          (typeof item.name === "string" && item.name.trim()) ||
          `${fileName.replace(/\.json$/i, "")} ${index + 1}`,
        strength: clampNumber(item.strength ?? item.reference_strength, 0.6, 0, 1),
        information: clampNumber(
          item.information ?? item.information_extracted ?? item.reference_information_extracted,
          1,
          0.1,
          1,
        ),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

const defaultNegative =
  "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]";

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function loadBitmap(file: File) {
  if ("createImageBitmap" in window) return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function prepareVibeImage(file: File) {
  const image = await loadBitmap(file);
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const sourceRatio = sourceWidth / sourceHeight;
  const targets = [
    { width: 1024, height: 1536 },
    { width: 1536, height: 1024 },
    { width: 1472, height: 1472 },
  ];
  const target = targets.reduce((best, current) =>
    Math.abs(sourceRatio - current.width / current.height) <
    Math.abs(sourceRatio - best.width / best.height)
      ? current
      : best,
  );
  const scale = Math.min(target.width / sourceWidth, target.height / sourceHeight);
  const drawWidth = Math.round(sourceWidth * scale);
  const drawHeight = Math.round(sourceHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理这张图片");
  context.fillStyle = "#000";
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(
    image,
    Math.round((target.width - drawWidth) / 2),
    Math.round((target.height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  );
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("图片处理失败"))),
      "image/png",
    ),
  );
  if ("close" in image && typeof image.close === "function") image.close();
  return blobToBase64(blob);
}

function friendlyError(status: number, detail: string) {
  if (status === 401) return "Key 无效或已经失效，请重新检查 pst- Key。";
  if (status === 402) return "Anlas 余额不足，暂时无法完成这次生成。";
  if (status === 429) return "请求太频繁了，稍等一会儿再试。";
  if (status === 400 || status === 422)
    return `参数没有被 NAI 接受。${detail ? ` ${detail}` : ""}`;
  return `生成失败（${status}）。${detail ? ` ${detail}` : "请稍后重试。"}`;
}

function shapeStyle(width: number, height: number) {
  const max = 34;
  return width >= height
    ? { width: max, height: Math.max(16, Math.round((max * height) / width)) }
    : { width: Math.max(16, Math.round((max * width) / height)), height: max };
}

function formatTime(value: string) {
  const date = new Date(value.endsWith("Z") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const galleryDbName = "nai-vibe-gallery";
const galleryStoreName = "images";

function openGalleryDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(galleryDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(galleryStoreName)) {
        request.result.createObjectStore(galleryStoreName, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readGalleryRecords() {
  const db = await openGalleryDb();
  return new Promise<GalleryRecord[]>((resolve, reject) => {
    const request = db.transaction(galleryStoreName, "readonly").objectStore(galleryStoreName).getAll();
    request.onsuccess = () => resolve((request.result as GalleryRecord[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100));
    request.onerror = () => reject(request.error);
  });
}

async function writeGalleryRecord(record: GalleryRecord) {
  const db = await openGalleryDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(galleryStoreName, "readwrite").objectStore(galleryStoreName).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeGalleryRecord(id: string) {
  const db = await openGalleryDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(galleryStoreName, "readwrite").objectStore(galleryStoreName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"create" | "gallery">("create");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [brandName, setBrandName] = useState("JunNAI");
  const [brandSubtitle, setBrandSubtitle] = useState("简单、直接的手机生图页");
  const [brandIconText, setBrandIconText] = useState("N");
  const [brandColor, setBrandColor] = useState("#6f50dd");
  const [brandLogo, setBrandLogo] = useState("");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceError, setAppearanceError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [artistString, setArtistString] = useState("");
  const [artistEnabled, setArtistEnabled] = useState(true);
  const [artistPresets, setArtistPresets] = useState<ArtistPreset[]>([]);
  const [selectedArtistPresetId, setSelectedArtistPresetId] = useState("");
  const [artistPresetName, setArtistPresetName] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [negative, setNegative] = useState(defaultNegative);
  const [sizeKey, setSizeKey] = useState<SizeKey>("portrait");
  const [customWidth, setCustomWidth] = useState(832);
  const [customHeight, setCustomHeight] = useState(1216);
  const [generationCount, setGenerationCount] = useState(1);
  const [model, setModel] = useState("nai-diffusion-4-5-full");
  const [steps, setSteps] = useState(28);
  const [scale, setScale] = useState(6);
  const [sampler, setSampler] = useState("k_euler_ancestral");
  const [seed, setSeed] = useState("");
  const [vibes, setVibes] = useState<VibeItem[]>([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [results, setResults] = useState<ResultItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState("");
  const [selectedImage, setSelectedImage] = useState<GalleryItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const brandLogoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedKey = localStorage.getItem("nai-vibe-key") ?? sessionStorage.getItem("nai-vibe-key") ?? "";
      setApiKey(savedKey);
      if (savedKey) localStorage.setItem("nai-vibe-key", savedKey);
      sessionStorage.removeItem("nai-vibe-key");
      setNegative(localStorage.getItem("nai-negative-prompt") ?? defaultNegative);
      setBrandName(localStorage.getItem("nai-brand-name") ?? "JunNAI");
      setBrandSubtitle(localStorage.getItem("nai-brand-subtitle") ?? "简单、直接的手机生图页");
      setBrandIconText(localStorage.getItem("nai-brand-icon-text") ?? "N");
      setBrandColor(localStorage.getItem("nai-brand-color") ?? "#6f50dd");
      setBrandLogo(localStorage.getItem("nai-brand-logo") ?? "");
      setArtistString(localStorage.getItem("nai-artist-string") ?? "");
      setArtistEnabled(localStorage.getItem("nai-artist-enabled") !== "false");
      try {
        const savedPresets = JSON.parse(localStorage.getItem("nai-artist-presets") ?? "[]");
        if (Array.isArray(savedPresets)) setArtistPresets(savedPresets.slice(0, 50));
      } catch {
        localStorage.removeItem("nai-artist-presets");
      }
      setSelectedArtistPresetId(localStorage.getItem("nai-artist-selected") ?? "");
      const savedCount = Number(localStorage.getItem("nai-generation-count"));
      if ([1, 2, 3, 4, 5, 6].includes(savedCount)) setGenerationCount(savedCount);
      const savedWidth = Number(localStorage.getItem("nai-custom-width"));
      const savedHeight = Number(localStorage.getItem("nai-custom-height"));
      if (Number.isFinite(savedWidth)) setCustomWidth(normalizeDimension(savedWidth));
      if (Number.isFinite(savedHeight)) setCustomHeight(normalizeDimension(savedHeight));
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    if (apiKey) localStorage.setItem("nai-vibe-key", apiKey);
    else localStorage.removeItem("nai-vibe-key");
    localStorage.setItem("nai-negative-prompt", negative);
    localStorage.setItem("nai-brand-name", brandName);
    localStorage.setItem("nai-brand-subtitle", brandSubtitle);
    localStorage.setItem("nai-brand-icon-text", brandIconText);
    localStorage.setItem("nai-brand-color", brandColor);
    if (brandLogo) localStorage.setItem("nai-brand-logo", brandLogo);
    else localStorage.removeItem("nai-brand-logo");
    localStorage.setItem("nai-artist-string", artistString);
    localStorage.setItem("nai-artist-enabled", String(artistEnabled));
    localStorage.setItem("nai-artist-presets", JSON.stringify(artistPresets));
    localStorage.setItem("nai-artist-selected", selectedArtistPresetId);
    localStorage.setItem("nai-generation-count", String(generationCount));
    localStorage.setItem("nai-custom-width", String(customWidth));
    localStorage.setItem("nai-custom-height", String(customHeight));
  }, [
    apiKey,
    artistEnabled,
    artistPresets,
    artistString,
    brandColor,
    brandIconText,
    brandLogo,
    brandName,
    brandSubtitle,
    customHeight,
    customWidth,
    generationCount,
    negative,
    preferencesReady,
    selectedArtistPresetId,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadGallery(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const size =
    sizeKey === "custom"
      ? {
          width: normalizeDimension(customWidth),
          height: normalizeDimension(customHeight),
          label: "自定义尺寸",
          hint: `${normalizeDimension(customWidth)} × ${normalizeDimension(customHeight)}`,
        }
      : sizes[sizeKey];
  const isSmallPreset = sizeKey.startsWith("small");
  const opusUnlimitedReady = isSmallPreset && generationCount === 1 && steps <= 28;
  const quantityOptions = isSmallPreset ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4];
  const strengthTotal = useMemo(
    () => vibes.reduce((sum, vibe) => sum + vibe.strength, 0),
    [vibes],
  );

  useEffect(() => {
    if (!isSmallPreset && generationCount > 4) setGenerationCount(4);
  }, [generationCount, isSmallPreset]);

  async function importBrandLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAppearanceError("请选择 PNG、JPG 或 WebP 图片。");
      return;
    }
    try {
      setBrandLogo(await prepareBrandLogo(file));
      setAppearanceError("");
    } catch (caught) {
      setAppearanceError(caught instanceof Error ? caught.message : "图标读取失败。");
    }
  }

  function resetBrandDesign() {
    setBrandName("JunNAI");
    setBrandSubtitle("简单、直接的手机生图页");
    setBrandIconText("N");
    setBrandColor("#6f50dd");
    setBrandLogo("");
    setAppearanceError("");
  }

  async function loadGallery() {
    setGalleryLoading(true);
    setGalleryError("");
    try {
      const records = await readGalleryRecords();
      gallery.forEach((item) => URL.revokeObjectURL(item.imageUrl));
      setGallery(records.map(({ blob, ...item }) => ({ ...item, imageUrl: URL.createObjectURL(blob) })));
    } catch (caught) {
      setGalleryError(caught instanceof Error ? caught.message : "图库暂时加载失败");
    } finally {
      setGalleryLoading(false);
    }
  }

  async function saveToGallery(blob: Blob, promptText: string, seedText: string) {
    await writeGalleryRecord({
      id: crypto.randomUUID(),
      blob,
      prompt: promptText,
      artistString: artistEnabled ? artistString.trim() : "",
      seed: seedText,
      width: size.width,
      height: size.height,
      createdAt: new Date().toISOString(),
    });
  }

  async function deleteGalleryImage(item: GalleryItem) {
    try {
      await removeGalleryRecord(item.id);
    } catch {
      setGalleryError("删除失败，请稍后重试");
      return;
    }
    URL.revokeObjectURL(item.imageUrl);
    setGallery((current) => current.filter((image) => image.id !== item.id));
    setSelectedImage(null);
  }

  function selectArtistPreset(id: string) {
    setSelectedArtistPresetId(id);
    if (!id) {
      setArtistPresetName("");
      return;
    }
    const preset = artistPresets.find((item) => item.id === id);
    if (!preset) return;
    setArtistPresetName(preset.name);
    setArtistString(preset.value);
    setArtistEnabled(true);
  }

  function saveArtistPreset() {
    const name = artistPresetName.trim();
    const value = artistString.trim();
    if (!name || !value) return;
    if (selectedArtistPresetId) {
      setArtistPresets((current) =>
        current.map((preset) =>
          preset.id === selectedArtistPresetId ? { ...preset, name, value } : preset,
        ),
      );
      return;
    }
    const preset = { id: crypto.randomUUID(), name, value };
    setArtistPresets((current) => [...current, preset]);
    setSelectedArtistPresetId(preset.id);
  }

  function newArtistPreset() {
    setSelectedArtistPresetId("");
    setArtistPresetName("");
    setArtistString("");
  }

  function deleteArtistPreset() {
    if (!selectedArtistPresetId) return;
    setArtistPresets((current) =>
      current.filter((preset) => preset.id !== selectedArtistPresetId),
    );
    newArtistPreset();
  }

  function updateVibe(id: string, update: Partial<VibeItem>, resetEncoding = false) {
    setVibes((current) =>
      current.map((vibe) =>
        vibe.id === id
          ? {
              ...vibe,
              ...update,
              ...(resetEncoding && vibe.source === "image"
                ? { encoding: undefined, encodingKey: undefined }
                : {}),
            }
          : vibe,
      ),
    );
  }

  function removeVibe(id: string) {
    setVibes((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return current.filter((item) => item.id !== id);
    });
  }

  function clearResults() {
    results.forEach((result) => URL.revokeObjectURL(result.url));
    setResults([]);
  }

  async function addVibes(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!picked.length) return;
    const additions: VibeItem[] = [];
    let importError = "";

    for (const file of picked) {
      if (vibes.length + additions.length >= 4) break;
      if (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")) {
        try {
          const parsed = parseVibeJson(JSON.parse(await file.text()), file.name);
          for (const item of parsed) {
            if (vibes.length + additions.length >= 4) break;
            additions.push({
              id: crypto.randomUUID(),
              source: "json",
              name: item.name,
              strength: item.strength,
              information: item.information,
              encoding: item.encoding,
            });
          }
          if (!parsed.length) importError = `${file.name} 中没有找到可识别的 Vibe encoding。`;
        } catch (caught) {
          importError = caught instanceof Error ? caught.message : `${file.name} 读取失败。`;
        }
        continue;
      }
      if (!file.type.startsWith("image/")) {
        importError = `${file.name} 不是支持的图片或 JSON 文件。`;
        continue;
      }
      additions.push({
        id: crypto.randomUUID(),
        source: "image",
        name: file.name,
        file,
        preview: URL.createObjectURL(file),
        strength: 0.6,
        information: 1,
      });
    }

    if (additions.length) setVibes((current) => [...current, ...additions].slice(0, 4));
    setError(importError);
  }

  async function encodeVibe(vibe: VibeItem, key: string) {
    if (vibe.source === "json" && vibe.encoding) return vibe.encoding;
    const encodingKey = `${model}:${vibe.information}`;
    if (vibe.encoding && vibe.encodingKey === encodingKey) return vibe.encoding;
    if (!vibe.file) throw new Error(`${vibe.name} 缺少图片或有效 encoding。`);
    const image = await prepareVibeImage(vibe.file);
    const response = await fetch("https://image.novelai.net/ai/encode-vibe", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ image, model, information_extracted: vibe.information }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(friendlyError(response.status, detail.slice(0, 180)));
    }
    const encoding = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
    updateVibe(vibe.id, { encoding, encodingKey });
    return encoding;
  }

  async function generate() {
    const key = apiKey.trim();
    const basePrompt = prompt.replaceAll("\\", "").trim();
    const cleanArtist = artistString.replaceAll("\\", "").trim();
    const combinedPrompt =
      artistEnabled && cleanArtist ? `${cleanArtist}, ${basePrompt}` : basePrompt;
    if (!key.startsWith("pst-")) {
      setError("请先填写正确的 pst- 开头 Key。");
      return;
    }
    if (!basePrompt) {
      setError("请先填写提示词。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const encodings: string[] = [];
      if (vibes.length) {
        setStatus(`正在准备 Vibe（0/${vibes.length}）`);
        for (let i = 0; i < vibes.length; i += 1) {
          encodings.push(await encodeVibe(vibes[i], key));
          setStatus(`正在准备 Vibe（${i + 1}/${vibes.length}）`);
        }
      }
      setStatus(`正在生成 ${generationCount} 张图片…`);
      const randomSeed = seed.trim()
        ? Math.max(0, Math.min(4294967295, Number(seed)))
        : Math.floor(Math.random() * 4294967295);
      const cleanNegative = negative.replaceAll("\\", "").trim();
      const parameters: Record<string, unknown> = {
        params_version: 3,
        width: size.width,
        height: size.height,
        scale,
        sampler,
        steps,
        seed: randomSeed,
        n_samples: generationCount,
        noise_schedule: "karras",
        sm: false,
        sm_dyn: false,
        dynamic_thresholding: false,
        uc: cleanNegative,
        v4_prompt: {
          caption: { base_caption: combinedPrompt, char_captions: [] },
          use_coords: false,
          use_order: true,
        },
        v4_negative_prompt: {
          caption: { base_caption: cleanNegative, char_captions: [] },
        },
      };
      if (encodings.length) {
        parameters.reference_image_multiple = encodings;
        parameters.reference_strength_multiple = vibes.map((vibe) => vibe.strength);
        parameters.reference_information_extracted_multiple = vibes.map(
          (vibe) => vibe.information,
        );
      }
      const response = await fetch("https://image.novelai.net/ai/generate-image", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: combinedPrompt,
          model,
          action: "generate",
          parameters,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(friendlyError(response.status, detail.slice(0, 180)));
      }
      setStatus("正在打开图片…");
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const entries = Object.entries(files)
        .filter(([name]) => name.toLowerCase().endsWith(".png"))
        .sort(([a], [b]) => a.localeCompare(b));
      if (!entries.length) throw new Error("NAI 已返回结果，但没有找到 PNG 图片。");

      results.forEach((result) => URL.revokeObjectURL(result.url));
      const nextResults = entries.map(([, bytes], index) => {
        const blob = new Blob([bytes as BlobPart], { type: "image/png" });
        return { blob, index, url: URL.createObjectURL(blob) };
      });
      setResults(nextResults);
      setSeed(String(randomSeed));

      setStatus(`正在保存到图库（0/${nextResults.length}）`);
      const saved = await Promise.allSettled(
        nextResults.map((result) =>
          saveToGallery(result.blob, combinedPrompt, String(randomSeed)),
        ),
      );
      const failed = saved.filter((item) => item.status === "rejected").length;
      if (failed) setNotice(`图片已生成，但有 ${failed} 张没有保存进图库。`);
      await loadGallery();
      setStatus(`生成完成，共 ${nextResults.length} 张`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成失败，请稍后重试。");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`app-shell ${activeTab === "gallery" ? "gallery-mode" : ""}`}>
      <header className="topbar">
        <button className="brand-mark" type="button" onClick={() => setAppearanceOpen(true)} aria-label="自定义顶部设计" style={{ background: brandColor }}>
          {brandLogo ? <img src={brandLogo} alt="" /> : brandIconText.trim().slice(0, 2) || "N"}
        </button>
        <div className="brand-copy">
          <h1>{brandName.trim() || "JunNAI"}</h1>
          <p>{brandSubtitle.trim() || "简单、直接的手机生图页"}</p>
        </div>
        <nav className="top-tabs" aria-label="页面切换">
          <button className={activeTab === "create" ? "active" : ""} onClick={() => setActiveTab("create")}>生图</button>
          <button className={activeTab === "gallery" ? "active" : ""} onClick={() => { setActiveTab("gallery"); void loadGallery(); }}>图库{gallery.length ? <b>{gallery.length}</b> : null}</button>
        </nav>
      </header>

      {activeTab === "gallery" ? (
        <section className="gallery-page">
          <div className="gallery-heading">
            <div><h2>我的图库</h2><p>保存在当前设备，最多展示最近 100 张</p></div>
            <button onClick={() => void loadGallery()} disabled={galleryLoading}>{galleryLoading ? "载入中" : "刷新"}</button>
          </div>
          {galleryError && <div className="message error-message"><strong>图库没有加载成功</strong><span>{galleryError}</span></div>}
          {!galleryLoading && gallery.length === 0 && !galleryError ? (
            <div className="gallery-empty"><span>▧</span><strong>图库还是空的</strong><p>下一次生成的图片会自动出现在这里</p><button onClick={() => setActiveTab("create")}>去生图</button></div>
          ) : (
            <div className="gallery-grid">
              {gallery.map((item) => (
                <button className="gallery-tile" key={item.id} onClick={() => setSelectedImage(item)}>
                  <img src={item.imageUrl} alt="图库中的 NAI 生成图" loading="lazy" />
                  <span><b>{item.width} × {item.height}</b><small>{formatTime(item.createdAt)}</small></span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <div className="workspace">
          <section className="result-panel" aria-live="polite">
            {results.length ? (
              <div className={`result-wrap ${results.length > 1 ? "multi-results" : ""}`}>
                <div className="result-grid">
                  {results.map((result) => (
                    <div className="result-item" key={result.index}>
                      <img src={result.url} alt={`NovelAI 生成结果 ${result.index + 1}`} className="result-image" />
                      <a className="image-download" href={result.url} download={`nai-${seed}-${result.index + 1}.png`}>下载第 {result.index + 1} 张</a>
                    </div>
                  ))}
                </div>
                <div className="result-actions">
                  <button className="secondary-button" onClick={() => setActiveTab("gallery")}>打开图库</button>
                  <button className="secondary-button" onClick={clearResults}>收起图片</button>
                </div>
              </div>
            ) : (
              <div className="empty-result"><div className="sparkle">✦</div><strong>图片会显示在这里</strong><span>填写提示词，想参考画风就添加 Vibe</span></div>
            )}
          </section>

          <section className="control-card">
            <label className="field-label" htmlFor="api-key"><span>NAI Key</span><small>pst- 开头</small></label>
            <div className="key-field"><input id="api-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴你的 pst- Key" autoCapitalize="none" autoCorrect="off" spellCheck={false} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button><button type="button" className="clear-key" onClick={() => setApiKey("")} disabled={!apiKey}>清除</button></div>
            <p className="helper">Key 会长期保存在当前设备的这个浏览器中，并直接发送给 NovelAI。请不要在公共设备上保存。</p>
          </section>

          <section className="control-card prompt-card">
            <label className="field-label" htmlFor="prompt"><span>提示词</span><small>支持 NAI 标签与 {'{ }'} 权重</small></label>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：1girl, solo, long black hair, blue highlights…" rows={7} spellCheck={false} />
            <div className="prompt-tools"><span>{prompt.length} 字符</span><button type="button" onClick={() => setPrompt("")} disabled={!prompt}>清空</button></div>
            <div className="artist-divider" />
            <div className="artist-heading"><label htmlFor="artist-string"><span>画师串</span><small>自动放在每次提示词最前面</small></label><button type="button" className={`mini-switch ${artistEnabled ? "on" : ""}`} onClick={() => setArtistEnabled((value) => !value)} aria-pressed={artistEnabled}>{artistEnabled ? "已启用" : "未启用"}</button></div>
            <div className="artist-preset-picker">
              <select value={selectedArtistPresetId} onChange={(event) => selectArtistPreset(event.target.value)} aria-label="选择画师串预设">
                <option value="">选择已保存的画师串</option>
                {artistPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
              <button type="button" onClick={newArtistPreset}>新建</button>
              <button type="button" className="delete-preset" disabled={!selectedArtistPresetId} onClick={deleteArtistPreset}>删除</button>
            </div>
            <textarea id="artist-string" className="artist-input" value={artistString} onChange={(event) => setArtistString(event.target.value)} placeholder="例如：artist:name, year 2024, amazing quality" rows={3} spellCheck={false} />
            <div className="artist-preset-save">
              <input value={artistPresetName} onChange={(event) => setArtistPresetName(event.target.value)} placeholder="预设名称，例如：厚涂画师串" />
              <button type="button" disabled={!artistPresetName.trim() || !artistString.trim()} onClick={saveArtistPreset}>{selectedArtistPresetId ? "更新预设" : "保存预设"}</button>
            </div>
            <p className="helper">画师串和预设都保存在当前设备，选择名称即可立即切换。</p>
          </section>

          <section className="control-card vibe-card">
            <div className="section-heading"><div><h2>Vibe 参考</h2><p>支持图片和带 encoding 的 JSON，最多 4 个</p></div><span className="optional">可选</span></div>
            {vibes.length === 0 ? (
              <button className="vibe-upload" type="button" onClick={() => fileInput.current?.click()}><span className="upload-icon">＋</span><span><strong>导入 Vibe</strong><small>JPG、PNG、WebP 或 JSON</small></span></button>
            ) : (
              <div className="vibe-list">
                {vibes.map((vibe, index) => (
                  <article className="vibe-item" key={vibe.id}>
                    {vibe.preview ? <img src={vibe.preview} alt={`Vibe 参考图 ${index + 1}`} /> : <div className="json-vibe-preview"><strong>JSON</strong><small>已导入编码</small></div>}
                    <div className="vibe-controls">
                      <div className="vibe-title"><span><strong>Vibe {index + 1}</strong><small>{vibe.name}</small></span><button onClick={() => removeVibe(vibe.id)}>移除</button></div>
                      <label><span>影响强度 <b>{vibe.strength.toFixed(2)}</b></span><input type="range" min="0" max="1" step="0.05" value={vibe.strength} onChange={(event) => updateVibe(vibe.id, { strength: Number(event.target.value) })} /></label>
                      <details><summary>信息提取：{vibe.information.toFixed(2)}</summary><input type="range" min="0.1" max="1" step="0.05" value={vibe.information} onChange={(event) => updateVibe(vibe.id, { information: Number(event.target.value) }, true)} /><small>{vibe.source === "json" ? "JSON 已含编码，修改数值不会重新编码。" : "修改后会重新编码，并再次消耗编码费用。"}</small></details>
                    </div>
                  </article>
                ))}
                {vibes.length < 4 && <button className="add-another" type="button" onClick={() => fileInput.current?.click()}>＋ 再导入一个</button>}
              </div>
            )}
            <input ref={fileInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,application/json,.json" multiple onChange={(event) => void addVibes(event)} />
            {vibes.length > 0 && <div className={`vibe-note ${strengthTotal > 1 ? "warning" : ""}`}><span>图片 Vibe 首次编码通常消耗 2 Anlas；JSON 编码可直接使用</span><strong>总强度 {strengthTotal.toFixed(2)}</strong>{strengthTotal > 1 && <small>建议把总强度调到 1.00 以内</small>}</div>}
          </section>

          <section className="control-card">
            <div className="section-heading compact"><div><h2>尺寸与数量</h2><p>尺寸越大、一次生成越多，消耗通常越高</p></div></div>
            <div className="size-grid">
              {(Object.keys(sizes) as PresetSizeKey[]).map((item) => (
                <button key={item} type="button" className={sizeKey === item ? "active" : ""} onClick={() => setSizeKey(item)}><span className="size-shape" style={shapeStyle(sizes[item].width, sizes[item].height)} /><span><strong>{sizes[item].label}</strong><small>{sizes[item].hint}</small></span></button>
              ))}
              <button type="button" className={sizeKey === "custom" ? "active" : ""} onClick={() => setSizeKey("custom")}><span className="size-shape custom-shape">↔</span><span><strong>自定义</strong><small>{normalizeDimension(customWidth)} × {normalizeDimension(customHeight)}</small></span></button>
            </div>
            {sizeKey === "custom" && <div className="custom-size-panel">
              <label><span>宽度</span><input type="number" min="256" max="2048" step="64" value={customWidth} onChange={(event) => setCustomWidth(Number(event.target.value))} onBlur={() => setCustomWidth(normalizeDimension(customWidth))} /></label>
              <button type="button" aria-label="交换宽高" onClick={() => { setCustomWidth(customHeight); setCustomHeight(customWidth); }}>⇄</button>
              <label><span>高度</span><input type="number" min="256" max="2048" step="64" value={customHeight} onChange={(event) => setCustomHeight(Number(event.target.value))} onBlur={() => setCustomHeight(normalizeDimension(customHeight))} /></label>
              <small>会自动取最接近的 64 倍数，范围 256–2048。</small>
            </div>}
            {isSmallPreset && <div className={`opus-unlimited-note ${opusUnlimitedReady ? "ready" : ""}`}><div><strong>{opusUnlimitedReady ? "已符合 Opus 不耗 Anlas 条件" : "Opus 不限额小图"}</strong><small>需单张生成、Steps 不超过 28；图片 Vibe 首次编码仍可能消耗 Anlas。</small></div>{!opusUnlimitedReady && <button type="button" onClick={() => { setGenerationCount(1); setSteps(Math.min(steps, 28)); }}>应用不限额设置</button>}</div>}
            <div className="quantity-row"><div><strong>生成数量</strong><small>{isSmallPreset ? "小图一次最多 6 张；批量生成会消耗 Anlas" : "一次生成 1–4 张"}</small></div><div className="quantity-control" aria-label="生成数量">{quantityOptions.map((count) => <button key={count} className={generationCount === count ? "active" : ""} onClick={() => setGenerationCount(count)}>{count}</button>)}</div></div>
          </section>

          <section className="control-card advanced-card">
            <button className="advanced-toggle" type="button" onClick={() => setAdvancedOpen((value) => !value)} aria-expanded={advancedOpen}><span><strong>高级设置</strong><small>一般保持默认就可以</small></span><b>{advancedOpen ? "收起" : "展开"}</b></button>
            {advancedOpen && <div className="advanced-body"><label><span>模型</span><select value={model} onChange={(event) => { setModel(event.target.value); setVibes((current) => current.map((vibe) => vibe.source === "image" ? { ...vibe, encoding: undefined, encodingKey: undefined } : vibe)); }}><option value="nai-diffusion-4-5-full">V4.5 Full</option><option value="nai-diffusion-4-5-curated">V4.5 Curated</option></select></label><label><span>负面提示词 <small>自动保存在当前设备</small></span><textarea rows={5} value={negative} onChange={(event) => setNegative(event.target.value)} spellCheck={false} /></label><div className="two-cols"><label><span>Steps</span><input type="number" min="1" max="50" value={steps} onChange={(event) => setSteps(Number(event.target.value))} /></label><label><span>Guidance</span><input type="number" min="0" max="10" step="0.1" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label></div><label><span>采样器</span><select value={sampler} onChange={(event) => setSampler(event.target.value)}><option value="k_euler_ancestral">Euler Ancestral（推荐）</option><option value="k_euler">Euler</option><option value="k_dpmpp_2s_ancestral">DPM++ 2S Ancestral</option><option value="k_dpmpp_2m">DPM++ 2M</option><option value="k_dpmpp_sde">DPM++ SDE</option></select></label><label><span>Seed <small>留空则随机</small></span><input type="number" min="0" max="4294967295" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="随机" /></label></div>}
          </section>

          {error && <div className="message error-message" role="alert"><strong>没有生成成功</strong><span>{error}</span></div>}
          {notice && <div className="message notice-message">{notice}</div>}
          {status && !error && <div className="message status-message"><span className={busy ? "spinner" : "done-dot"} />{status}</div>}
        </div>
      )}

      {activeTab === "create" && <div className="generate-dock"><button className="generate-button" type="button" disabled={busy} onClick={generate}>{busy ? <><span className="button-spinner" />{status || "处理中…"}</> : <><span>✦</span>生成 {generationCount} 张图片</>}</button><small>图片生成后会自动保存到图库</small></div>}

      {appearanceOpen && <div className="appearance-modal" role="dialog" aria-modal="true" aria-label="顶部设计" onClick={() => setAppearanceOpen(false)}><section className="appearance-card" onClick={(event) => event.stopPropagation()}><div className="appearance-heading"><div><h2>顶部设计</h2><p>点击左上角图标可以随时回来修改</p></div><button type="button" onClick={() => setAppearanceOpen(false)} aria-label="关闭">×</button></div><div className="appearance-preview"><div className="brand-mark" style={{ background: brandColor }}>{brandLogo ? <img src={brandLogo} alt="预览图标" /> : brandIconText.trim().slice(0, 2) || "N"}</div><div><strong>{brandName.trim() || "JunNAI"}</strong><small>{brandSubtitle.trim() || "简单、直接的手机生图页"}</small></div></div><div className="appearance-fields"><label><span>网站名称</span><input value={brandName} maxLength={20} onChange={(event) => setBrandName(event.target.value)} placeholder="JunNAI" /></label><label><span>副标题</span><input value={brandSubtitle} maxLength={40} onChange={(event) => setBrandSubtitle(event.target.value)} placeholder="简单、直接的手机生图页" /></label><div className="appearance-row"><label><span>图标文字</span><input value={brandIconText} maxLength={2} onChange={(event) => setBrandIconText(event.target.value)} placeholder="N" disabled={Boolean(brandLogo)} /></label><label><span>图标颜色</span><input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} /></label></div></div><div className="appearance-actions"><button type="button" onClick={() => brandLogoInput.current?.click()}>{brandLogo ? "更换图标图片" : "上传图标图片"}</button>{brandLogo && <button type="button" onClick={() => setBrandLogo("")}>移除图片</button>}<button type="button" className="reset-design" onClick={resetBrandDesign}>恢复默认</button></div><input ref={brandLogoInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importBrandLogo(event)} />{appearanceError && <p className="appearance-error">{appearanceError}</p>}<button type="button" className="appearance-done" onClick={() => setAppearanceOpen(false)}>完成</button></section></div>}

      {selectedImage && <div className="gallery-modal" role="dialog" aria-modal="true" aria-label="图库图片详情" onClick={() => setSelectedImage(null)}><div className="gallery-modal-card" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedImage(null)} aria-label="关闭">×</button><img src={selectedImage.imageUrl} alt="放大的 NAI 生成图" /><div className="gallery-meta"><div className="meta-row"><span>{selectedImage.width} × {selectedImage.height}</span><span>Seed {selectedImage.seed}</span><span>{formatTime(selectedImage.createdAt)}</span></div>{selectedImage.artistString && <div><strong>画师串</strong><p>{selectedImage.artistString}</p></div>}<div><strong>完整提示词</strong><p>{selectedImage.prompt}</p></div><div className="modal-actions"><a href={selectedImage.imageUrl} download={`nai-${selectedImage.seed}.png`}>下载原图</a><button onClick={() => void deleteGalleryImage(selectedImage)}>删除图片</button></div></div></div></div>}
    </main>
  );
}

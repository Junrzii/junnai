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
  exampleImage?: string;
};

type CharacterPreset = {
  id: string;
  name: string;
  prompt: string;
  exampleImage?: string;
};

type ActiveTab = "create" | "artists" | "vibes" | "characters" | "gallery";
type ApiProvider = "official" | "custom";
type CustomAuthMode = "bearer" | "x-api-key" | "raw";
type VisualTheme = "lavender" | "mono" | "ios26" | "mint" | "rose" | "sky";

const visualThemes: Array<{
  id: VisualTheme;
  name: string;
  description: string;
  accent: string;
  swatches: [string, string, string];
}> = [
  { id: "lavender", name: "柔紫", description: "原版柔和紫色", accent: "#6f50dd", swatches: ["#6f50dd", "#eee9fa", "#ffffff"] },
  { id: "mono", name: "黑白简约", description: "干净利落的纯黑白", accent: "#111111", swatches: ["#111111", "#e8e8e8", "#ffffff"] },
  { id: "ios26", name: "iOS 26", description: "蓝色液态玻璃质感", accent: "#0a84ff", swatches: ["#0a84ff", "#dff2ff", "#ffffff"] },
  { id: "mint", name: "薄荷", description: "清爽低饱和绿色", accent: "#16876f", swatches: ["#16876f", "#def6ef", "#ffffff"] },
  { id: "rose", name: "樱粉", description: "柔和粉白配色", accent: "#c55480", swatches: ["#c55480", "#fae5ee", "#ffffff"] },
  { id: "sky", name: "雾蓝", description: "安静的灰蓝色", accent: "#456da8", swatches: ["#456da8", "#e2ecf8", "#ffffff"] },
];

type VibeItem = {
  id: string;
  libraryId?: string;
  source: "image" | "json";
  name: string;
  file?: File;
  preview?: string;
  strength: number;
  information: number;
  encoding?: string;
  encodingKey?: string;
};

type SavedVibeRecord = {
  id: string;
  name: string;
  source: "image" | "json";
  strength: number;
  information: number;
  encoding?: string;
  blob?: Blob;
  fileName?: string;
  mimeType?: string;
  createdAt: string;
};

type SavedVibeItem = SavedVibeRecord & { preview?: string };

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

function prepareLibraryImage(file: File) {
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
      const scale = Math.min(1, 384 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(source);
      resolve(canvas.toDataURL("image/webp", 0.65));
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error("图片读取失败，请换一张 PNG、JPG 或 WebP。"));
    };
    image.src = source;
  });
}

function joinEndpoint(baseUrl: string, path: string) {
  if (/^https?:\/\//i.test(path.trim())) return path.trim();
  return `${baseUrl.trim().replace(/\/+$/, "")}/${path.trim().replace(/^\/+/, "")}`;
}

function cleanEncoding(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^data:[^;]+;base64,/, "");
}

type ParsedVibeJson = {
  encoding: string;
  name: string;
  strength: number;
  information: number;
};

function parseVibeJson(data: unknown, fileName: string): ParsedVibeJson[] {
  if (!data || typeof data !== "object") throw new Error(`${fileName} 不是有效的 Vibe JSON。`);
  const root = data as Record<string, unknown>;
  const fileBaseName = fileName
    .replace(/\.json$/i, "")
    .replace(/\.naiv4vibebundle(?:\(\d+\))?$/i, "")
    .replace(/\.naiv4vibe(?:\(\d+\))?$/i, "");

  if (root.identifier === "novelai-vibe-transfer-bundle" && Array.isArray(root.vibes)) {
    const bundleVibes = root.vibes;
    return bundleVibes.flatMap((vibe, index) =>
      parseVibeJson(vibe, `${fileBaseName} ${index + 1}.json`).map((item, itemIndex, parsed) => ({
        ...item,
        name: bundleVibes.length === 1 && parsed.length === 1
          ? fileBaseName
          : `${fileBaseName} ${index + 1}${parsed.length > 1 ? `-${itemIndex + 1}` : ""}`,
      })),
    );
  }

  if (root.vibeData && typeof root.vibeData === "object" && !Array.isArray(root.vibeData)) {
    const presets = root.vibePresets && typeof root.vibePresets === "object" && !Array.isArray(root.vibePresets)
      ? root.vibePresets as Record<string, unknown>
      : {};
    const groups = root.groups && typeof root.groups === "object" && !Array.isArray(root.groups)
      ? root.groups as Record<string, unknown>
      : {};
    const presetByVibeId = new Map<string, { name: string; strength?: unknown; information?: unknown }>();
    Object.entries(presets).forEach(([name, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const preset = value as Record<string, unknown>;
      if (typeof preset.vibeDataId === "string") {
        presetByVibeId.set(preset.vibeDataId, {
          name,
          strength: preset.strength,
          information: preset.infoExtract ?? preset.information_extracted,
        });
      }
    });
    const groupStrengthByVibeId = new Map<string, unknown>();
    Object.values(groups).forEach((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const groupVibes = (value as Record<string, unknown>).vibes;
      if (!Array.isArray(groupVibes)) return;
      groupVibes.forEach((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
        const item = entry as Record<string, unknown>;
        if (typeof item.vibeDataId === "string") groupStrengthByVibeId.set(item.vibeDataId, item.strength);
      });
    });

    return Object.entries(root.vibeData as Record<string, unknown>).flatMap(([vibeDataId, vibe], index) => {
      const preset = presetByVibeId.get(vibeDataId);
      const displayName = preset?.name || `${fileBaseName} ${index + 1}`;
      return parseVibeJson(vibe, `${displayName}.json`).map((item, itemIndex, parsed) => ({
        ...item,
        name: parsed.length > 1 ? `${displayName} ${itemIndex + 1}` : displayName,
        strength: clampNumber(preset?.strength ?? groupStrengthByVibeId.get(vibeDataId), item.strength, 0, 1),
        information: clampNumber(preset?.information, item.information, 0.1, 1),
      }));
    });
  }

  const transferEncodings = root.encodings;
  if (
    root.identifier === "novelai-vibe-transfer" &&
    transferEncodings &&
    typeof transferEncodings === "object" &&
    !Array.isArray(transferEncodings)
  ) {
    const importInfo = root.importInfo && typeof root.importInfo === "object"
      ? root.importInfo as Record<string, unknown>
      : {};
    const baseName = typeof root.name === "string" && root.name.trim()
      ? root.name.trim()
      : fileName.replace(/\.naiv4vibe\.json$|\.json$/i, "");
    const found: Array<{
      encoding: string;
      name: string;
      strength: number;
      information: number;
    }> = [];

    function visitTransferNode(value: unknown) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const node = value as Record<string, unknown>;
      const encoding = cleanEncoding(node.encoding);
      if (encoding) {
        const params = node.params && typeof node.params === "object"
          ? node.params as Record<string, unknown>
          : {};
        found.push({
          encoding,
          name: baseName,
          strength: clampNumber(importInfo.strength ?? node.strength, 0.6, 0, 1),
          information: clampNumber(
            params.information_extracted ?? importInfo.information_extracted ?? node.information,
            1,
            0.1,
            1,
          ),
        });
        return;
      }
      Object.values(node).forEach((child) => visitTransferNode(child));
    }

    visitTransferNode(transferEncodings);
    return found.map((item, index) => ({
      ...item,
      name: found.length > 1 ? `${item.name} ${index + 1}` : item.name,
    }));
  }
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
  if (status === 401) return "Key 无效或已经失效，请重新检查当前连接使用的 Key。";
  if (status === 402) return "Anlas 余额不足，暂时无法完成这次生成。";
  if (status === 429) return "请求太频繁了，稍等一会儿再试。";
  if (status === 400 || status === 422)
    return `参数没有被 NAI 接受。${detail ? ` ${detail}` : ""}`;
  return `生成失败（${status}）。${detail ? ` ${detail}` : "请稍后重试。"}`;
}

function base64ToBlob(value: string, type = "image/png") {
  const clean = value.replace(/^data:[^;]+;base64,/, "");
  const bytes = Uint8Array.from(atob(clean), (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

async function readGeneratedImages(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = await response.json() as Record<string, unknown>;
    const nestedData = Array.isArray(data.data) ? data.data : [];
    const images = Array.isArray(data.images) ? data.images : [];
    const candidates = [
      ...nestedData,
      ...images,
      data.image,
      data.url,
      data.b64_json,
      data.base64,
      data.output,
    ].filter(Boolean);
    const blobs: Blob[] = [];
    for (const candidate of candidates) {
      const record = candidate && typeof candidate === "object"
        ? candidate as Record<string, unknown>
        : null;
      const value = typeof candidate === "string"
        ? candidate
        : String(record?.b64_json ?? record?.base64 ?? record?.image ?? record?.url ?? "");
      if (!value) continue;
      if (/^https?:\/\//i.test(value)) {
        const imageResponse = await fetch(value);
        if (!imageResponse.ok) throw new Error("第三方接口返回了图片地址，但浏览器无法读取该图片。");
        blobs.push(await imageResponse.blob());
      } else {
        blobs.push(base64ToBlob(value));
      }
    }
    if (!blobs.length) throw new Error("第三方接口已返回 JSON，但没有找到图片 URL 或 Base64 数据。");
    return blobs;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (contentType.startsWith("image/")) return [new Blob([bytes], { type: contentType })];
  try {
    const files = unzipSync(bytes);
    const entries = Object.entries(files)
      .filter(([name]) => /\.(png|jpe?g|webp)$/i.test(name))
      .sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length) throw new Error("压缩包中没有图片");
    return entries.map(([name, imageBytes]) => new Blob([imageBytes as BlobPart], {
      type: name.toLowerCase().endsWith(".webp")
        ? "image/webp"
        : /\.jpe?g$/i.test(name) ? "image/jpeg" : "image/png",
    }));
  } catch {
    throw new Error("接口已返回结果，但不是可识别的图片、JSON 或 ZIP。请检查第三方接口兼容性。");
  }
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
const vibeLibraryStoreName = "vibe-library";

function openGalleryDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(galleryDbName, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(galleryStoreName)) {
        request.result.createObjectStore(galleryStoreName, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(vibeLibraryStoreName)) {
        request.result.createObjectStore(vibeLibraryStoreName, { keyPath: "id" });
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

async function readSavedVibeRecords() {
  const db = await openGalleryDb();
  return new Promise<SavedVibeRecord[]>((resolve, reject) => {
    const request = db.transaction(vibeLibraryStoreName, "readonly").objectStore(vibeLibraryStoreName).getAll();
    request.onsuccess = () => resolve(
      (request.result as SavedVibeRecord[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
    request.onerror = () => reject(request.error);
  });
}

async function writeSavedVibeRecord(record: SavedVibeRecord) {
  const db = await openGalleryDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(vibeLibraryStoreName, "readwrite").objectStore(vibeLibraryStoreName).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function removeSavedVibeRecord(id: string) {
  const db = await openGalleryDb();
  return new Promise<void>((resolve, reject) => {
    const request = db.transaction(vibeLibraryStoreName, "readwrite").objectStore(vibeLibraryStoreName).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("create");
  const [apiProvider, setApiProvider] = useState<ApiProvider>("official");
  const [apiKey, setApiKey] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [customGeneratePath, setCustomGeneratePath] = useState("/ai/generate-image");
  const [customEncodePath, setCustomEncodePath] = useState("/ai/encode-vibe");
  const [customModel, setCustomModel] = useState("nai-diffusion-4-5-full");
  const [customAuthMode, setCustomAuthMode] = useState<CustomAuthMode>("bearer");
  const [showKey, setShowKey] = useState(false);
  const [brandName, setBrandName] = useState("JunNAI");
  const [brandSubtitle, setBrandSubtitle] = useState("简单、直接的手机生图页");
  const [brandIconText, setBrandIconText] = useState("N");
  const [brandColor, setBrandColor] = useState("#6f50dd");
  const [brandLogo, setBrandLogo] = useState("");
  const [visualTheme, setVisualTheme] = useState<VisualTheme>("lavender");
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [appearanceError, setAppearanceError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [artistString, setArtistString] = useState("");
  const [artistEnabled, setArtistEnabled] = useState(true);
  const [artistPresets, setArtistPresets] = useState<ArtistPreset[]>([]);
  const [selectedArtistPresetId, setSelectedArtistPresetId] = useState("");
  const [artistPresetName, setArtistPresetName] = useState("");
  const [artistExampleImage, setArtistExampleImage] = useState("");
  const [characters, setCharacters] = useState<CharacterPreset[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [editingCharacterId, setEditingCharacterId] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [characterPrompt, setCharacterPrompt] = useState("");
  const [characterExampleImage, setCharacterExampleImage] = useState("");
  const [characterSearch, setCharacterSearch] = useState("");
  const [copiedCharacterId, setCopiedCharacterId] = useState("");
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
  const [savedVibes, setSavedVibes] = useState<SavedVibeItem[]>([]);
  const [vibeLibraryLoading, setVibeLibraryLoading] = useState(false);
  const [vibeLibraryError, setVibeLibraryError] = useState("");
  const [vibeLibrarySearch, setVibeLibrarySearch] = useState("");
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
  const vibeLibraryInput = useRef<HTMLInputElement>(null);
  const brandLogoInput = useRef<HTMLInputElement>(null);
  const artistExampleInput = useRef<HTMLInputElement>(null);
  const characterExampleInput = useRef<HTMLInputElement>(null);

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
      const savedTheme = localStorage.getItem("nai-visual-theme");
      if (visualThemes.some((theme) => theme.id === savedTheme)) setVisualTheme(savedTheme as VisualTheme);
      setApiProvider(localStorage.getItem("nai-api-provider") === "custom" ? "custom" : "official");
      setCustomApiKey(localStorage.getItem("nai-custom-api-key") ?? "");
      setCustomBaseUrl(localStorage.getItem("nai-custom-base-url") ?? "");
      setCustomGeneratePath(localStorage.getItem("nai-custom-generate-path") ?? "/ai/generate-image");
      setCustomEncodePath(localStorage.getItem("nai-custom-encode-path") ?? "/ai/encode-vibe");
      setCustomModel(localStorage.getItem("nai-custom-model") ?? "nai-diffusion-4-5-full");
      const savedAuthMode = localStorage.getItem("nai-custom-auth-mode");
      if (savedAuthMode === "x-api-key" || savedAuthMode === "raw") setCustomAuthMode(savedAuthMode);
      setArtistString(localStorage.getItem("nai-artist-string") ?? "");
      setArtistEnabled(localStorage.getItem("nai-artist-enabled") !== "false");
      try {
        const savedPresets = JSON.parse(localStorage.getItem("nai-artist-presets") ?? "[]") as ArtistPreset[];
        const savedArtistId = localStorage.getItem("nai-artist-selected") ?? "";
        if (Array.isArray(savedPresets)) {
          const presets = savedPresets.slice(0, 50);
          setArtistPresets(presets);
          setArtistExampleImage(presets.find((item) => item.id === savedArtistId)?.exampleImage ?? "");
        }
        setSelectedArtistPresetId(savedArtistId);
      } catch {
        localStorage.removeItem("nai-artist-presets");
      }
      try {
        const savedCharacters = JSON.parse(localStorage.getItem("nai-character-presets") ?? "[]");
        if (Array.isArray(savedCharacters)) setCharacters(savedCharacters.slice(0, 40));
      } catch {
        localStorage.removeItem("nai-character-presets");
      }
      setSelectedCharacterId(localStorage.getItem("nai-character-selected") ?? "");
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
    localStorage.setItem("nai-api-provider", apiProvider);
    if (customApiKey) localStorage.setItem("nai-custom-api-key", customApiKey);
    else localStorage.removeItem("nai-custom-api-key");
    localStorage.setItem("nai-custom-base-url", customBaseUrl);
    localStorage.setItem("nai-custom-generate-path", customGeneratePath);
    localStorage.setItem("nai-custom-encode-path", customEncodePath);
    localStorage.setItem("nai-custom-model", customModel);
    localStorage.setItem("nai-custom-auth-mode", customAuthMode);
    localStorage.setItem("nai-negative-prompt", negative);
    localStorage.setItem("nai-brand-name", brandName);
    localStorage.setItem("nai-brand-subtitle", brandSubtitle);
    localStorage.setItem("nai-brand-icon-text", brandIconText);
    localStorage.setItem("nai-brand-color", brandColor);
    localStorage.setItem("nai-visual-theme", visualTheme);
    if (brandLogo) localStorage.setItem("nai-brand-logo", brandLogo);
    else localStorage.removeItem("nai-brand-logo");
    localStorage.setItem("nai-artist-string", artistString);
    localStorage.setItem("nai-artist-enabled", String(artistEnabled));
    localStorage.setItem("nai-artist-presets", JSON.stringify(artistPresets));
    localStorage.setItem("nai-artist-selected", selectedArtistPresetId);
    localStorage.setItem("nai-character-presets", JSON.stringify(characters));
    localStorage.setItem("nai-character-selected", selectedCharacterId);
    localStorage.setItem("nai-generation-count", String(generationCount));
    localStorage.setItem("nai-custom-width", String(customWidth));
    localStorage.setItem("nai-custom-height", String(customHeight));
  }, [
    apiKey,
    apiProvider,
    artistEnabled,
    artistPresets,
    artistString,
    brandColor,
    brandIconText,
    brandLogo,
    brandName,
    brandSubtitle,
    characters,
    customApiKey,
    customAuthMode,
    customBaseUrl,
    customEncodePath,
    customGeneratePath,
    customHeight,
    customModel,
    customWidth,
    generationCount,
    negative,
    preferencesReady,
    selectedArtistPresetId,
    selectedCharacterId,
    visualTheme,
  ]);

  useEffect(() => {
    document.documentElement.dataset.theme = visualTheme;
  }, [visualTheme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGallery();
      void loadVibeLibrary();
    }, 0);
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
  const activeApiKey = apiProvider === "official" ? apiKey : customApiKey;
  const activeBaseUrl = apiProvider === "official" ? "https://image.novelai.net" : customBaseUrl;
  const requestModel = apiProvider === "official" ? model : customModel.trim() || model;
  const selectedCharacter = characters.find((item) => item.id === selectedCharacterId) ?? null;
  const currentArtistPreset = artistPresets.find((item) => item.id === selectedArtistPresetId) ?? null;
  const filteredCharacters = characters.filter((item) =>
    `${item.name} ${item.prompt}`.toLowerCase().includes(characterSearch.trim().toLowerCase()),
  );
  const filteredSavedVibes = savedVibes.filter((item) =>
    item.name.toLowerCase().includes(vibeLibrarySearch.trim().toLowerCase()),
  );
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

  function apiHeaders(key: string) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiProvider === "official" || customAuthMode === "bearer") headers.Authorization = `Bearer ${key}`;
    else if (customAuthMode === "x-api-key") headers["x-api-key"] = key;
    else headers.Authorization = key;
    return headers;
  }

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
    setVisualTheme("lavender");
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

  async function loadVibeLibrary() {
    setVibeLibraryLoading(true);
    setVibeLibraryError("");
    try {
      const records = await readSavedVibeRecords();
      setSavedVibes((current) => {
        current.forEach((item) => {
          if (item.preview) URL.revokeObjectURL(item.preview);
        });
        return records.map((record) => ({
          ...record,
          preview: record.blob ? URL.createObjectURL(record.blob) : undefined,
        }));
      });
    } catch (caught) {
      setVibeLibraryError(caught instanceof Error ? caught.message : "Vibe 库暂时加载失败。");
    } finally {
      setVibeLibraryLoading(false);
    }
  }

  async function saveVibeToLibrary(vibe: VibeItem) {
    const id = vibe.libraryId ?? crypto.randomUUID();
    await writeSavedVibeRecord({
      id,
      name: vibe.name.replace(/\.(png|jpe?g|webp|naiv4vibe\.json|json)$/i, "") || "未命名 Vibe",
      source: vibe.source,
      strength: vibe.strength,
      information: vibe.information,
      encoding: vibe.encoding,
      blob: vibe.file,
      fileName: vibe.file?.name,
      mimeType: vibe.file?.type,
      createdAt: new Date().toISOString(),
    });
    return id;
  }

  async function saveCurrentVibesToLibrary() {
    if (!vibes.length) return;
    try {
      const ids = new Map<string, string>();
      for (const vibe of vibes) ids.set(vibe.id, await saveVibeToLibrary(vibe));
      setVibes((current) => current.map((vibe) => ({ ...vibe, libraryId: ids.get(vibe.id) ?? vibe.libraryId })));
      await loadVibeLibrary();
      setNotice(`已把 ${vibes.length} 个 Vibe 保存到当前设备。`);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vibe 保存失败。");
    }
  }

  async function importVibesToLibrary(event: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!picked.length) return;
    let savedCount = 0;
    let importError = "";
    for (const file of picked) {
      if (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")) {
        try {
          const parsed = parseVibeJson(JSON.parse(await file.text()), file.name);
          for (const item of parsed) {
            await writeSavedVibeRecord({
              id: crypto.randomUUID(),
              name: item.name,
              source: "json",
              strength: item.strength,
              information: item.information,
              encoding: item.encoding,
              createdAt: new Date().toISOString(),
            });
            savedCount += 1;
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
      await writeSavedVibeRecord({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.(png|jpe?g|webp)$/i, ""),
        source: "image",
        strength: 0.6,
        information: 1,
        blob: file,
        fileName: file.name,
        mimeType: file.type,
        createdAt: new Date().toISOString(),
      });
      savedCount += 1;
    }
    await loadVibeLibrary();
    setError(importError);
    if (savedCount) setNotice(`已导入并保存 ${savedCount} 个 Vibe。`);
  }

  function useSavedVibe(item: SavedVibeItem) {
    if (vibes.length >= 4) {
      setError("当前生图区最多使用 4 个 Vibe，请先移除一个。");
      return;
    }
    if (vibes.some((vibe) => vibe.libraryId === item.id)) {
      setError("这个 Vibe 已经在当前生图区里了。");
      return;
    }
    const file = item.blob
      ? new File([item.blob], item.fileName ?? `${item.name}.png`, { type: item.mimeType ?? item.blob.type })
      : undefined;
    setVibes((current) => [...current, {
      id: crypto.randomUUID(),
      libraryId: item.id,
      source: item.source,
      name: item.name,
      file,
      preview: item.blob ? URL.createObjectURL(item.blob) : undefined,
      strength: item.strength,
      information: item.information,
      encoding: item.encoding,
    }].slice(0, 4));
    setActiveTab("create");
    setError("");
    setNotice(`${item.name} 已加入当前生图。`);
  }

  async function updateSavedVibe(id: string, update: Partial<SavedVibeRecord>) {
    const target = savedVibes.find((item) => item.id === id);
    if (!target) return;
    const { preview: _preview, ...record } = target;
    await writeSavedVibeRecord({ ...record, ...update });
    setSavedVibes((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
  }

  async function deleteSavedVibe(item: SavedVibeItem) {
    try {
      await removeSavedVibeRecord(item.id);
      if (item.preview) URL.revokeObjectURL(item.preview);
      setSavedVibes((current) => current.filter((saved) => saved.id !== item.id));
      setVibes((current) => current.map((vibe) => vibe.libraryId === item.id ? { ...vibe, libraryId: undefined } : vibe));
    } catch {
      setVibeLibraryError("删除失败，请稍后重试。");
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
      setArtistExampleImage("");
      return;
    }
    const preset = artistPresets.find((item) => item.id === id);
    if (!preset) return;
    setArtistPresetName(preset.name);
    setArtistString(preset.value);
    setArtistExampleImage(preset.exampleImage ?? "");
    setArtistEnabled(true);
  }

  function saveArtistPreset() {
    const name = artistPresetName.trim();
    const value = artistString.trim();
    if (!name || !value) return;
    if (selectedArtistPresetId) {
      setArtistPresets((current) =>
        current.map((preset) =>
          preset.id === selectedArtistPresetId ? { ...preset, name, value, exampleImage: artistExampleImage || undefined } : preset,
        ),
      );
      return;
    }
    const preset = { id: crypto.randomUUID(), name, value, exampleImage: artistExampleImage || undefined };
    setArtistPresets((current) => [...current, preset]);
    setSelectedArtistPresetId(preset.id);
  }

  function newArtistPreset() {
    setSelectedArtistPresetId("");
    setArtistPresetName("");
    setArtistString("");
    setArtistExampleImage("");
  }

  function deleteArtistPreset() {
    if (!selectedArtistPresetId) return;
    setArtistPresets((current) =>
      current.filter((preset) => preset.id !== selectedArtistPresetId),
    );
    newArtistPreset();
  }

  async function importArtistExample(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择 PNG、JPG 或 WebP 例图。");
      return;
    }
    try {
      setArtistExampleImage(await prepareLibraryImage(file));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "画师串例图读取失败。");
    }
  }

  function startNewCharacter() {
    setEditingCharacterId("");
    setCharacterName("");
    setCharacterPrompt("");
    setCharacterExampleImage("");
  }

  function editCharacter(character: CharacterPreset) {
    setEditingCharacterId(character.id);
    setCharacterName(character.name);
    setCharacterPrompt(character.prompt);
    setCharacterExampleImage(character.exampleImage ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveCharacter() {
    const name = characterName.trim();
    const characterValue = characterPrompt.trim();
    if (!name || !characterValue) return;
    if (editingCharacterId) {
      setCharacters((current) => current.map((item) => item.id === editingCharacterId ? { ...item, name, prompt: characterValue, exampleImage: characterExampleImage || undefined } : item));
    } else {
      const character = { id: crypto.randomUUID(), name, prompt: characterValue, exampleImage: characterExampleImage || undefined };
      setCharacters((current) => [character, ...current].slice(0, 40));
      setEditingCharacterId(character.id);
    }
    setNotice("角色已保存在当前设备。");
  }

  function deleteCharacter(id: string) {
    setCharacters((current) => current.filter((item) => item.id !== id));
    if (selectedCharacterId === id) setSelectedCharacterId("");
    if (editingCharacterId === id) startNewCharacter();
  }

  async function importCharacterExample(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择 PNG、JPG 或 WebP 角色例图。");
      return;
    }
    try {
      setCharacterExampleImage(await prepareLibraryImage(file));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "角色例图读取失败。");
    }
  }

  async function copyCharacterPrompt(character: CharacterPreset) {
    try {
      await navigator.clipboard.writeText(character.prompt);
      setCopiedCharacterId(character.id);
      window.setTimeout(() => setCopiedCharacterId(""), 1400);
    } catch {
      setError("复制失败，请长按提示词手动复制。");
    }
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
    const encodingKey = `${apiProvider}:${activeBaseUrl}:${requestModel}:${vibe.information}`;
    if (vibe.encoding && vibe.encodingKey === encodingKey) return vibe.encoding;
    if (!vibe.file) throw new Error(`${vibe.name} 缺少图片或有效 encoding。`);
    const image = await prepareVibeImage(vibe.file);
    const response = await fetch(joinEndpoint(activeBaseUrl, apiProvider === "official" ? "/ai/encode-vibe" : customEncodePath), {
      method: "POST",
      headers: apiHeaders(key),
      body: JSON.stringify({ image, model: requestModel, information_extracted: vibe.information }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(friendlyError(response.status, detail.slice(0, 180)));
    }
    let encoding = "";
    if ((response.headers.get("content-type") ?? "").includes("application/json")) {
      const data = await response.json() as Record<string, unknown>;
      const nested = data.data && typeof data.data === "object" ? data.data as Record<string, unknown> : {};
      encoding = cleanEncoding(data.encoding ?? data.vibe_encoding ?? nested.encoding);
    } else {
      encoding = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
    }
    if (!encoding) throw new Error("Vibe 编码接口没有返回可识别的 encoding。");
    updateVibe(vibe.id, { encoding, encodingKey });
    return encoding;
  }

  async function generate() {
    const key = activeApiKey.trim();
    const basePrompt = prompt.replaceAll("\\", "").trim();
    const cleanArtist = artistString.replaceAll("\\", "").trim();
    const cleanCharacter = selectedCharacter?.prompt.replaceAll("\\", "").trim() ?? "";
    const combinedPrompt = [artistEnabled ? cleanArtist : "", cleanCharacter, basePrompt].filter(Boolean).join(", ");
    if (!key || (apiProvider === "official" && !key.startsWith("pst-"))) {
      setError(apiProvider === "official" ? "请先填写正确的 pst- 开头 Key。" : "请先填写第三方网站的 Key。");
      return;
    }
    if (apiProvider === "custom" && !/^https?:\/\//i.test(activeBaseUrl.trim())) {
      setError("请填写以 http:// 或 https:// 开头的第三方 API 地址。");
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
      const response = await fetch(joinEndpoint(activeBaseUrl, apiProvider === "official" ? "/ai/generate-image" : customGeneratePath), {
        method: "POST",
        headers: apiHeaders(key),
        body: JSON.stringify({
          input: combinedPrompt,
          model: requestModel,
          action: "generate",
          parameters,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(friendlyError(response.status, detail.slice(0, 180)));
      }
      setStatus("正在打开图片…");
      const blobs = await readGeneratedImages(response);
      results.forEach((result) => URL.revokeObjectURL(result.url));
      const nextResults = blobs.map((blob, index) => ({ blob, index, url: URL.createObjectURL(blob) }));
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
          <button className={activeTab === "artists" ? "active" : ""} onClick={() => setActiveTab("artists")}>画师</button>
          <button className={activeTab === "vibes" ? "active" : ""} onClick={() => { setActiveTab("vibes"); void loadVibeLibrary(); }}>Vibe</button>
          <button className={activeTab === "characters" ? "active" : ""} onClick={() => setActiveTab("characters")}>角色</button>
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
      ) : activeTab === "artists" ? (
        <section className="library-page">
          <div className="library-heading">
            <div><span className="eyebrow">STYLE LIBRARY</span><h2>画师串库</h2><p>保存画师串和例图，生图时一键切换</p></div>
            <button type="button" onClick={newArtistPreset}>＋ 新建</button>
          </div>
          <div className="library-layout">
            <section className="library-editor">
              <div className="example-editor">
                {artistExampleImage ? <img src={artistExampleImage} alt="画师串例图" /> : <div className="example-placeholder"><span>◇</span><strong>添加例图</strong><small>方便辨认画风</small></div>}
                <div><button type="button" onClick={() => artistExampleInput.current?.click()}>{artistExampleImage ? "更换例图" : "上传例图"}</button>{artistExampleImage && <button type="button" className="quiet-danger" onClick={() => setArtistExampleImage("")}>移除</button>}</div>
                <input ref={artistExampleInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importArtistExample(event)} />
              </div>
              <label><span>预设名称</span><input value={artistPresetName} onChange={(event) => setArtistPresetName(event.target.value)} placeholder="例如：月光厚涂" /></label>
              <label><span>画师串</span><textarea value={artistString} onChange={(event) => setArtistString(event.target.value)} rows={5} placeholder="artist:name, year 2024, amazing quality" spellCheck={false} /></label>
              <div className="editor-actions"><button type="button" className="primary-action" disabled={!artistPresetName.trim() || !artistString.trim()} onClick={saveArtistPreset}>{selectedArtistPresetId ? "更新画师串" : "保存画师串"}</button>{selectedArtistPresetId && <button type="button" className="danger-action" onClick={deleteArtistPreset}>删除</button>}</div>
              <p className="helper">资料只保存在当前设备。例图会压缩后保存，不会上传到服务器。</p>
            </section>
            <div className="library-collection">
              {artistPresets.length === 0 ? <div className="library-empty"><strong>还没有画师串</strong><p>先在上方保存一个，之后就能直接切换。</p></div> : <div className="library-grid">
                {artistPresets.map((preset) => <article className={`library-card ${preset.id === selectedArtistPresetId ? "selected" : ""}`} key={preset.id}>
                  <button type="button" className="card-main" onClick={() => selectArtistPreset(preset.id)}>{preset.exampleImage ? <img src={preset.exampleImage} alt={`${preset.name} 例图`} loading="lazy" /> : <div className="card-placeholder">ART</div>}<span><strong>{preset.name}</strong><small>{preset.value}</small></span></button>
                  <div className="card-actions"><button type="button" onClick={() => { selectArtistPreset(preset.id); setActiveTab("create"); }}>用于生图</button><button type="button" onClick={() => selectArtistPreset(preset.id)}>编辑</button></div>
                </article>)}
              </div>}
            </div>
          </div>
        </section>
      ) : activeTab === "vibes" ? (
        <section className="library-page vibe-library-page">
          <div className="library-heading">
            <div><span className="eyebrow">VIBE LIBRARY</span><h2>Vibe 库</h2><p>图片与 JSON Vibe 保存在当前设备，随时一键加入生图</p></div>
            <button type="button" onClick={() => vibeLibraryInput.current?.click()}>＋ 导入 Vibe</button>
            <input ref={vibeLibraryInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,application/json,.json,.naiv4vibe.json" multiple onChange={(event) => void importVibesToLibrary(event)} />
          </div>
          <div className="library-search"><span>⌕</span><input value={vibeLibrarySearch} onChange={(event) => setVibeLibrarySearch(event.target.value)} placeholder="搜索 Vibe 名称" /></div>
          {vibeLibraryError && <div className="message error-message"><strong>Vibe 库没有加载成功</strong><span>{vibeLibraryError}</span></div>}
          {vibeLibraryLoading ? <div className="library-empty"><strong>正在载入 Vibe 库…</strong></div> : filteredSavedVibes.length === 0 ? <div className="library-empty"><strong>{savedVibes.length ? "没有匹配的 Vibe" : "Vibe 库还是空的"}</strong><p>{savedVibes.length ? "换个名称搜索。" : "导入图片或 JSON；支持单个 Vibe、Vibe 合集和分组备份。"}</p></div> : <div className="vibe-library-grid">
            {filteredSavedVibes.map((item) => <article className="saved-vibe-card" key={item.id}>
              <div className="saved-vibe-preview">{item.preview ? <img src={item.preview} alt={`${item.name} Vibe`} loading="lazy" /> : <div><strong>JSON</strong><small>已保存编码</small></div>}<span>{item.source === "json" ? "JSON" : "图片"}</span></div>
              <div className="saved-vibe-body">
                <div className="saved-vibe-title"><strong>{item.name}</strong><small>{formatTime(item.createdAt)}</small></div>
                <label><span>影响强度 <b>{item.strength.toFixed(2)}</b></span><input type="range" min="0" max="1" step="0.05" value={item.strength} onChange={(event) => void updateSavedVibe(item.id, { strength: Number(event.target.value) })} /></label>
                <label><span>信息提取 <b>{item.information.toFixed(2)}</b></span><input type="range" min="0.1" max="1" step="0.05" value={item.information} onChange={(event) => void updateSavedVibe(item.id, { information: Number(event.target.value) })} /></label>
                <div className="saved-vibe-actions"><button type="button" onClick={() => useSavedVibe(item)}>用于生图</button><button type="button" className="delete-saved-vibe" onClick={() => void deleteSavedVibe(item)}>删除</button></div>
              </div>
            </article>)}
          </div>}
          <p className="local-storage-note">Vibe 编码和原始图片保存在当前浏览器的 IndexedDB，不会上传到 GitHub。清除网站数据时会一并删除。</p>
        </section>
      ) : activeTab === "characters" ? (
        <section className="library-page">
          <div className="library-heading">
            <div><span className="eyebrow">CHARACTER LIBRARY</span><h2>角色库</h2><p>保存角色提示词，需要时复制或直接用于生图</p></div>
            <button type="button" onClick={startNewCharacter}>＋ 新建</button>
          </div>
          <div className="library-layout">
            <section className="library-editor">
              <div className="example-editor">
                {characterExampleImage ? <img src={characterExampleImage} alt="角色例图" /> : <div className="example-placeholder"><span>♙</span><strong>添加角色图</strong><small>可选</small></div>}
                <div><button type="button" onClick={() => characterExampleInput.current?.click()}>{characterExampleImage ? "更换例图" : "上传例图"}</button>{characterExampleImage && <button type="button" className="quiet-danger" onClick={() => setCharacterExampleImage("")}>移除</button>}</div>
                <input ref={characterExampleInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importCharacterExample(event)} />
              </div>
              <label><span>角色名称</span><input value={characterName} onChange={(event) => setCharacterName(event.target.value)} placeholder="例如：蓝发骑士" /></label>
              <label><span>角色提示词</span><textarea value={characterPrompt} onChange={(event) => setCharacterPrompt(event.target.value)} rows={6} placeholder="角色外观、服装和固定特征…" spellCheck={false} /></label>
              <div className="editor-actions"><button type="button" className="primary-action" disabled={!characterName.trim() || !characterPrompt.trim()} onClick={saveCharacter}>{editingCharacterId ? "更新角色" : "保存角色"}</button>{editingCharacterId && <button type="button" className="danger-action" onClick={() => deleteCharacter(editingCharacterId)}>删除</button>}</div>
              <p className="helper">保存后可直接复制，也可选为当前生图角色；不会覆盖你输入的场景提示词。</p>
            </section>
            <div className="library-collection">
              <div className="library-search"><span>⌕</span><input value={characterSearch} onChange={(event) => setCharacterSearch(event.target.value)} placeholder="搜索角色名称或提示词" /></div>
              {filteredCharacters.length === 0 ? <div className="library-empty"><strong>{characters.length ? "没有匹配的角色" : "还没有角色"}</strong><p>{characters.length ? "换个关键词试试。" : "在上方建立你的第一个角色。"}</p></div> : <div className="library-grid">
                {filteredCharacters.map((character) => <article className={`library-card ${character.id === selectedCharacterId ? "selected" : ""}`} key={character.id}>
                  <button type="button" className="card-main" onClick={() => editCharacter(character)}>{character.exampleImage ? <img src={character.exampleImage} alt={`${character.name} 例图`} loading="lazy" /> : <div className="card-placeholder character">CHAR</div>}<span><strong>{character.name}</strong><small>{character.prompt}</small></span></button>
                  <div className="card-actions three"><button type="button" onClick={() => void copyCharacterPrompt(character)}>{copiedCharacterId === character.id ? "已复制" : "复制"}</button><button type="button" onClick={() => { setSelectedCharacterId(character.id); setActiveTab("create"); }}>用于生图</button><button type="button" onClick={() => editCharacter(character)}>编辑</button></div>
                </article>)}
              </div>}
            </div>
          </div>
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

          <section className="control-card connection-card">
            <div className="section-heading compact"><div><h2>连接方式</h2><p>官方 NovelAI 或兼容它请求格式的第三方接口</p></div></div>
            <div className="provider-switch"><button type="button" className={apiProvider === "official" ? "active" : ""} onClick={() => setApiProvider("official")}><strong>官方 NAI</strong><small>pst- Key</small></button><button type="button" className={apiProvider === "custom" ? "active" : ""} onClick={() => setApiProvider("custom")}><strong>第三方兼容</strong><small>自定义地址与 Key</small></button></div>
            {apiProvider === "official" ? <>
              <label className="field-label" htmlFor="api-key"><span>NAI Key</span><small>pst- 开头</small></label>
              <div className="key-field"><input id="api-key" type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="粘贴你的 pst- Key" autoCapitalize="none" autoCorrect="off" spellCheck={false} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button><button type="button" className="clear-key" onClick={() => setApiKey("")} disabled={!apiKey}>清除</button></div>
              <p className="helper">Key 长期保存在当前浏览器，只会在生图时直接发送给 NovelAI。</p>
            </> : <div className="custom-api-fields">
              <label><span>第三方 API 地址</span><input value={customBaseUrl} onChange={(event) => setCustomBaseUrl(event.target.value)} placeholder="https://example.com" autoCapitalize="none" spellCheck={false} /></label>
              <label><span>第三方 Key</span><div className="key-field"><input type={showKey ? "text" : "password"} value={customApiKey} onChange={(event) => setCustomApiKey(event.target.value)} placeholder="填写第三方网站提供的 Key" autoCapitalize="none" spellCheck={false} /><button type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? "隐藏" : "显示"}</button><button type="button" className="clear-key" onClick={() => setCustomApiKey("")} disabled={!customApiKey}>清除</button></div></label>
              <div className="two-cols"><label><span>生图路径</span><input value={customGeneratePath} onChange={(event) => setCustomGeneratePath(event.target.value)} placeholder="/ai/generate-image" /></label><label><span>Vibe 编码路径</span><input value={customEncodePath} onChange={(event) => setCustomEncodePath(event.target.value)} placeholder="/ai/encode-vibe" /></label></div>
              <div className="two-cols"><label><span>模型名称</span><input value={customModel} onChange={(event) => { setCustomModel(event.target.value); setVibes((current) => current.map((vibe) => vibe.source === "image" ? { ...vibe, encoding: undefined, encodingKey: undefined } : vibe)); }} placeholder="nai-diffusion-4-5-full" /></label><label><span>鉴权方式</span><select value={customAuthMode} onChange={(event) => setCustomAuthMode(event.target.value as CustomAuthMode)}><option value="bearer">Bearer Key</option><option value="x-api-key">x-api-key</option><option value="raw">Authorization 原值</option></select></label></div>
              <p className="helper">接口需允许浏览器跨域访问，并兼容 NAI 请求。结果支持 ZIP、图片、图片 URL 或 Base64 JSON。</p>
            </div>}
          </section>

          <section className="control-card prompt-card">
            <label className="field-label" htmlFor="prompt"><span>提示词</span><small>支持 NAI 标签与 {'{ }'} 权重</small></label>
            <textarea id="prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="例如：1girl, solo, long black hair, blue highlights…" rows={7} spellCheck={false} />
            <div className="prompt-tools"><span>{prompt.length} 字符</span><button type="button" onClick={() => setPrompt("")} disabled={!prompt}>清空</button></div>
            <div className="prompt-library-links">
              <div className="active-preset-row">
                {currentArtistPreset?.exampleImage ? <img src={currentArtistPreset.exampleImage} alt="当前画师串例图" /> : <div className="mini-placeholder">ART</div>}
                <span><strong>当前画师串</strong><small>{currentArtistPreset?.name ?? (artistString.trim() ? "未保存的画师串" : "未选择")}</small></span>
                <button type="button" className={`mini-switch ${artistEnabled ? "on" : ""}`} onClick={() => setArtistEnabled((value) => !value)}>{artistEnabled ? "启用" : "关闭"}</button>
                <button type="button" className="open-library" onClick={() => setActiveTab("artists")}>画师库</button>
              </div>
              <div className="active-preset-row">
                {selectedCharacter?.exampleImage ? <img src={selectedCharacter.exampleImage} alt="当前角色例图" /> : <div className="mini-placeholder character">CHAR</div>}
                <span><strong>当前角色</strong><small>{selectedCharacter?.name ?? "未选择"}</small></span>
                {selectedCharacter && <button type="button" className="remove-active" onClick={() => setSelectedCharacterId("")}>移除</button>}
                <button type="button" className="open-library" onClick={() => setActiveTab("characters")}>角色库</button>
              </div>
            </div>
            {artistEnabled && artistString.trim() && <details className="active-prompt-detail"><summary>查看当前画师串</summary><p>{artistString}</p></details>}
          </section>

          <section className="control-card vibe-card">
            <div className="section-heading"><div><h2>Vibe 参考</h2><p>支持图片、普通 encoding JSON 和 NovelAI Vibe JSON，最多 4 个</p></div><div className="section-heading-actions"><button type="button" onClick={() => { setActiveTab("vibes"); void loadVibeLibrary(); }}>Vibe 库</button><span className="optional">可选</span></div></div>
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
            <input ref={fileInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp,application/json,.json,.naiv4vibe.json" multiple onChange={(event) => void addVibes(event)} />
            {vibes.length > 0 && <div className={`vibe-note ${strengthTotal > 1 ? "warning" : ""}`}><span>图片 Vibe 首次编码通常消耗 2 Anlas；JSON 编码可直接使用</span><strong>总强度 {strengthTotal.toFixed(2)}</strong>{strengthTotal > 1 && <small>建议把总强度调到 1.00 以内</small>}</div>}
            {vibes.length > 0 && <div className="vibe-library-actions"><button type="button" onClick={() => void saveCurrentVibesToLibrary()}>保存当前到 Vibe 库</button><button type="button" onClick={() => { setActiveTab("vibes"); void loadVibeLibrary(); }}>管理 Vibe 库</button></div>}
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

      <nav className="bottom-nav" aria-label="手机页面切换">
        <button type="button" className={activeTab === "create" ? "active" : ""} onClick={() => setActiveTab("create")}><span>✦</span><small>生图</small></button>
        <button type="button" className={activeTab === "artists" ? "active" : ""} onClick={() => setActiveTab("artists")}><span>◇</span><small>画师</small></button>
        <button type="button" className={activeTab === "vibes" ? "active" : ""} onClick={() => { setActiveTab("vibes"); void loadVibeLibrary(); }}><span>◈</span><small>Vibe</small></button>
        <button type="button" className={activeTab === "characters" ? "active" : ""} onClick={() => setActiveTab("characters")}><span>♙</span><small>角色</small></button>
        <button type="button" className={activeTab === "gallery" ? "active" : ""} onClick={() => { setActiveTab("gallery"); void loadGallery(); }}><span>▧</span><small>图库</small></button>
      </nav>

      {appearanceOpen && <div className="appearance-modal" role="dialog" aria-modal="true" aria-label="外观设计" onClick={() => setAppearanceOpen(false)}>
        <section className="appearance-card" onClick={(event) => event.stopPropagation()}>
          <div className="appearance-heading"><div><h2>外观设计</h2><p>主题和顶部内容都会自动保存在当前设备</p></div><button type="button" onClick={() => setAppearanceOpen(false)} aria-label="关闭">×</button></div>
          <div className="theme-section">
            <div className="theme-section-title"><strong>颜色与样式</strong><small>点击即可切换整站主题</small></div>
            <div className="theme-picker">
              {visualThemes.map((theme) => <button key={theme.id} type="button" className={visualTheme === theme.id ? "active" : ""} aria-pressed={visualTheme === theme.id} onClick={() => { setVisualTheme(theme.id); setBrandColor(theme.accent); }}>
                <span className="theme-swatches">{theme.swatches.map((color) => <i key={color} style={{ background: color }} />)}</span>
                <span><strong>{theme.name}</strong><small>{theme.description}</small></span>
                <b>{visualTheme === theme.id ? "✓" : ""}</b>
              </button>)}
            </div>
          </div>
          <div className="appearance-preview"><div className="brand-mark" style={{ background: brandColor }}>{brandLogo ? <img src={brandLogo} alt="预览图标" /> : brandIconText.trim().slice(0, 2) || "N"}</div><div><strong>{brandName.trim() || "JunNAI"}</strong><small>{brandSubtitle.trim() || "简单、直接的手机生图页"}</small></div></div>
          <div className="appearance-fields"><label><span>网站名称</span><input value={brandName} maxLength={20} onChange={(event) => setBrandName(event.target.value)} placeholder="JunNAI" /></label><label><span>副标题</span><input value={brandSubtitle} maxLength={40} onChange={(event) => setBrandSubtitle(event.target.value)} placeholder="简单、直接的手机生图页" /></label><div className="appearance-row"><label><span>图标文字</span><input value={brandIconText} maxLength={2} onChange={(event) => setBrandIconText(event.target.value)} placeholder="N" disabled={Boolean(brandLogo)} /></label><label><span>图标颜色</span><input type="color" value={brandColor} onChange={(event) => setBrandColor(event.target.value)} /></label></div></div>
          <div className="appearance-actions"><button type="button" onClick={() => brandLogoInput.current?.click()}>{brandLogo ? "更换图标图片" : "上传图标图片"}</button>{brandLogo && <button type="button" onClick={() => setBrandLogo("")}>移除图片</button>}<button type="button" className="reset-design" onClick={resetBrandDesign}>恢复默认</button></div>
          <input ref={brandLogoInput} className="hidden-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void importBrandLogo(event)} />
          {appearanceError && <p className="appearance-error">{appearanceError}</p>}
          <button type="button" className="appearance-done" onClick={() => setAppearanceOpen(false)}>完成</button>
        </section>
      </div>}

      {selectedImage && <div className="gallery-modal" role="dialog" aria-modal="true" aria-label="图库图片详情" onClick={() => setSelectedImage(null)}><div className="gallery-modal-card" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedImage(null)} aria-label="关闭">×</button><img src={selectedImage.imageUrl} alt="放大的 NAI 生成图" /><div className="gallery-meta"><div className="meta-row"><span>{selectedImage.width} × {selectedImage.height}</span><span>Seed {selectedImage.seed}</span><span>{formatTime(selectedImage.createdAt)}</span></div>{selectedImage.artistString && <div><strong>画师串</strong><p>{selectedImage.artistString}</p></div>}<div><strong>完整提示词</strong><p>{selectedImage.prompt}</p></div><div className="modal-actions"><a href={selectedImage.imageUrl} download={`nai-${selectedImage.seed}.png`}>下载原图</a><button onClick={() => void deleteGalleryImage(selectedImage)}>删除图片</button></div></div></div></div>}
    </main>
  );
}

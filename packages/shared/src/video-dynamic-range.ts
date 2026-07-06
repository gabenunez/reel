export interface VideoDynamicRange {
  dolbyVision: boolean;
  dolbyVisionProfile: number | null;
  hdr10: boolean;
  hlg: boolean;
}

export type FfprobeVideoStreamColor = {
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  side_data_list?: Array<{
    side_data_type?: string;
    dv_profile?: number;
  }>;
};

export function parseVideoDynamicRangeFromStream(
  stream: FfprobeVideoStreamColor | null | undefined,
): VideoDynamicRange {
  const result: VideoDynamicRange = {
    dolbyVision: false,
    dolbyVisionProfile: null,
    hdr10: false,
    hlg: false,
  };

  if (!stream) return result;

  for (const side of stream.side_data_list ?? []) {
    const sideType = side.side_data_type ?? "";
    if (sideType.includes("DOVI") || sideType.includes("Dolby Vision")) {
      result.dolbyVision = true;
      if (typeof side.dv_profile === "number") {
        result.dolbyVisionProfile = side.dv_profile;
      }
    }
  }

  const transfer = (stream.color_transfer ?? "").toLowerCase();
  const primaries = (stream.color_primaries ?? "").toLowerCase();
  const space = (stream.color_space ?? "").toLowerCase();
  const isBt2020 =
    primaries.includes("bt2020") || space.includes("bt2020");

  if (transfer.includes("2084") || transfer.includes("smpte2084")) {
    result.hdr10 = isBt2020 || !result.dolbyVision;
  }
  if (transfer.includes("hlg") || transfer.includes("arib-std-b67")) {
    result.hlg = true;
  }

  if (result.dolbyVision && result.dolbyVisionProfile === 8) {
    result.hdr10 = true;
  }

  return result;
}

export function needsHdrToneMap(
  dynamicRange: VideoDynamicRange | null | undefined,
): boolean {
  return Boolean(dynamicRange?.dolbyVision || dynamicRange?.hdr10 || dynamicRange?.hlg);
}

export function formatDynamicRangeLabel(
  dynamicRange: VideoDynamicRange | null | undefined,
): string | null {
  if (!dynamicRange) return null;
  if (dynamicRange.dolbyVision) {
    return dynamicRange.dolbyVisionProfile != null
      ? `Dolby Vision (Profile ${dynamicRange.dolbyVisionProfile})`
      : "Dolby Vision";
  }
  if (dynamicRange.hdr10) return "HDR10";
  if (dynamicRange.hlg) return "HLG";
  return null;
}

export function formatDynamicRangeShort(
  dynamicRange: VideoDynamicRange | null | undefined,
): string | null {
  if (!dynamicRange) return null;
  if (dynamicRange.dolbyVision) {
    return dynamicRange.dolbyVisionProfile != null
      ? `Dolby Vision P${dynamicRange.dolbyVisionProfile}`
      : "Dolby Vision";
  }
  if (dynamicRange.hdr10) return "HDR10";
  if (dynamicRange.hlg) return "HLG";
  return null;
}

/** Watch-player chrome suffix — omits SDR / unknown ranges (never renders "null"). */
export function formatDynamicRangeChromeSuffix(
  dynamicRange: VideoDynamicRange | null | undefined,
): string {
  const label = formatDynamicRangeShort(dynamicRange);
  return label ? ` · ${label}` : "";
}

export function buildTranscodeVideoFilter(
  height: number,
  dynamicRange: VideoDynamicRange | null | undefined,
): string {
  const scale = `scale=-2:${height}`;
  if (!needsHdrToneMap(dynamicRange)) {
    return scale;
  }
  return `${scale},tonemap=tonemap=hable:desat=0,format=yuv420p`;
}

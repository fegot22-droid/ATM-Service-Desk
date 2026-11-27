import type {Guide, GuideBlock, GuideSection} from '../types/atm';

const IMG_RE = /^\[img:\s*([\w.\-]+)\]$/;

export function parseGuideMarkdown(
  id: string,
  subtitle: string,
  sourceFileName: string,
  rawText: string,
): Guide {
  let title = '';
  const sections: GuideSection[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (line.startsWith('## ')) {
      sections.push({title: line.slice(3).trim(), blocks: []});
    } else if (line.startsWith('# ') && !title) {
      title = line.slice(2).trim();
    } else if (sections.length > 0) {
      const imgMatch = IMG_RE.exec(trimmed);
      const blocks = sections[sections.length - 1].blocks;
      if (imgMatch) {
        blocks.push({kind: 'img', value: imgMatch[1]});
      } else if (blocks.length > 0 && blocks[blocks.length - 1].kind === 'text') {
        blocks[blocks.length - 1] = {
          kind: 'text',
          value: `${blocks[blocks.length - 1].value}\n${line}`,
        };
      } else {
        blocks.push({kind: 'text', value: line});
      }
    }
  }

  for (const sec of sections) {
    const cleaned: GuideBlock[] = [];
    for (const block of sec.blocks) {
      if (block.kind === 'img') {
        cleaned.push(block);
      } else {
        const val = block.value.trim();
        if (val) cleaned.push({kind: 'text', value: val});
      }
    }
    sec.blocks = cleaned;
  }

  return {
    id,
    title: title || id.toUpperCase(),
    subtitle,
    sourceFileName,
    sections,
  };
}

export interface TextSegment {
  kind: 'paragraph' | 'code' | 'step';
  text: string;
}

const REGISTRY_OR_PATH_RE =
  /^(\[HKEY_|"[^"]+"=|C:\\|D:\\|E:\\|W:\\|\\\\\d|Host=|Port=|Ssl|MAXFILESIZE=|LOGBYDAY=|MERGEDTRACE=|TRACE=|<font\s)/i;

export function segmentGuideText(raw: string): TextSegment[] {
  const lines = raw.split('\n');
  const segments: TextSegment[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (REGISTRY_OR_PATH_RE.test(trimmed)) {
      const prev = segments[segments.length - 1];
      if (prev && prev.kind === 'code') {
        prev.text = `${prev.text}\n${trimmed}`;
      } else {
        segments.push({kind: 'code', text: trimmed});
      }
    } else if (/^\d+[.)]\s+/.test(trimmed)) {
      segments.push({kind: 'step', text: trimmed});
    } else {
      segments.push({kind: 'paragraph', text: trimmed});
    }
  }

  return segments;
}

export interface CrossGuideMatch {
  guideId: string;
  guideTitle: string;
  sectionIndex: number;
  sectionTitle: string;
  snippet: string;
}

export function searchAllGuides(
  guides: Guide[],
  rawQuery: string,
): CrossGuideMatch[] {
  const needle = rawQuery.trim().toLowerCase();
  if (needle.length < 2) return [];

  const matches: CrossGuideMatch[] = [];
  for (const guide of guides) {
    guide.sections.forEach((sec, idx) => {
      const titleHit = sec.title.toLowerCase().includes(needle);
      let snippet = '';
      for (const block of sec.blocks) {
        if (block.kind !== 'text') continue;
        const pos = block.value.toLowerCase().indexOf(needle);
        if (pos !== -1) {
          const start = Math.max(0, pos - 40);
          const end = Math.min(block.value.length, pos + needle.length + 70);
          snippet =
            (start > 0 ? '…' : '') +
            block.value.slice(start, end).replace(/\s+/g, ' ').trim() +
            (end < block.value.length ? '…' : '');
          break;
        }
      }
      if (titleHit || snippet) {
        matches.push({
          guideId: guide.id,
          guideTitle: guide.id.toUpperCase(),
          sectionIndex: idx,
          sectionTitle: sec.title,
          snippet: snippet || sec.title,
        });
      }
    });
  }
  return matches;
}

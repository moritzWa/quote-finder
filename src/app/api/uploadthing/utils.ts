import { encoding_for_model } from '@dqbd/tiktoken';
import EPub from 'epub';
import fs from 'fs';
import { htmlToText } from 'html-to-text';
import https from 'https';
import path from 'path';

export const countTokens = (text: string) => {
  const encoder = encoding_for_model("gpt-3.5-turbo");
  const tokens = encoder.encode(text);
  encoder.free();
  return tokens.length;
}

const splitContent = (content: string, maxTokens: number) => {
  const sentences = content.split('. ');
  const chunks = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    const newChunk = currentChunk + sentence + '. ';
    if (countTokens(newChunk) > maxTokens) {
      chunks.push(currentChunk);
      currentChunk = sentence + '. ';
    } else {
      currentChunk = newChunk;
    }
  }

  chunks.push(currentChunk); // Add the last chunk
  return chunks;
}



export const sanitize = (text: string) => {
  // Replace ambiguous Unicode characters with a space
  return text.replace(/[\u{0080}-\u{FFFF}]/gu, ' ');
}

export function parseFileSize(fileSizeString: string): number {
    const [value, unit] = fileSizeString.match(/^(\d+)(\w+)$/)!.slice(1, 3)
    const valueNum = parseInt(value, 10)
    switch (unit.toUpperCase()) {
      case 'B':
        return valueNum
      case 'KB':
        return valueNum * 1024
      case 'MB':
        return valueNum * 1024 * 1024
      case 'GB':
        return valueNum * 1024 * 1024 * 1024
      default:
        throw new Error(`Invalid file size unit: ${unit}`)
    }
  }

export async function downloadFileToString(url: string, destination: string): Promise<string> {
    const file = fs.createWriteStream(destination);
    const request = https.get(url, function(response) {
        response.pipe(file);
    });

    return new Promise((resolve, reject) => {
        file.on('finish', () => resolve(destination));
        file.on('error', reject);
    });
}   

export async function downloadFile(url: string, destination: string) {
  const file = fs.createWriteStream(destination);
  const request = https.get(url, function(response) {
    response.pipe(file);
  });

  return new Promise((resolve, reject) => {
    file.on('finish', resolve);
    file.on('error', reject);
  });
}

export async function loadEpubFromUrl(url: string) {
  const filePath = path.join(__dirname, 'temp.epub');
  await downloadFile(url, filePath);
  return loadEpub(filePath);
}
interface Chapter {
  pageContent: string;
  metadata: {
    level: number;
    order: number;
    title: string;
    id: string;
    href: string;
  };
}

export async function loadEpub(filePath: string): Promise<Chapter[]> {
  const epub = new EPub(filePath);

  return new Promise((resolve, reject) => {
    epub.on('end', async function() {
      let chapters = await Promise.all<Chapter>(
        epub.flow.map((chapter) => {
          return new Promise<Chapter>((resolve, reject) => {
            epub.getChapter(chapter.id, (err, text) => {
              if (err) {
                reject(err);
              } else {
                resolve({
                  pageContent: htmlToText(text),
                  metadata: {
                    level: chapter.level,
                    order: chapter.order,
                    title: chapter.title,
                    id: chapter.id,
                    href: chapter.href,
                  },
                });
              }
            });
          });
        })
      );

      // Split chapters into smaller chunks
      chapters = chapters.flatMap((chapter) => {
        const chunks = [];
        let start = 0;
        let part = 1;

        while (start < chapter.pageContent.length) {
          let end = start + 3000;
          if (end < chapter.pageContent.length) {
            end = chapter.pageContent.lastIndexOf(' ', end) + 1;
          }
          chunks.push({
            pageContent: chapter.pageContent.slice(start, end + 23),
            metadata: {
              ...chapter.metadata,
              chapterPart: part,
              tokenCount: countTokens(chapter.pageContent.slice(start, end + 23)), // remove this eventually
            },
          });
          start = end;
          part++;
        }

        return chunks;
      });

      resolve(chapters);
    });
    epub.parse();
  });
}
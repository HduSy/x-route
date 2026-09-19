import { parseGPX } from '@x-route/gpx';

export type ParseRequest = {
    type: 'parse';
    requestId: number;
    fileName: string;
    xml: string;
};

export type ParseResponse =
    | {
          type: 'parsed';
          requestId: number;
          fileName: string;
          // Plain data (structured clone drops the GPXFile prototype) — the
          // main thread reconstructs a real instance via `new GPXFile(data)`.
          file: unknown;
      }
    | {
          type: 'error';
          requestId: number;
          fileName: string;
          message: string;
      };

self.onmessage = (event: MessageEvent<ParseRequest>) => {
    const { type, requestId, fileName, xml } = event.data;
    if (type !== 'parse') return;

    try {
        const file = parseGPX(xml);
        if (file.metadata === undefined) {
            file.metadata = {};
        }
        if (file.metadata.name === undefined || file.metadata.name.trim() === '') {
            file.metadata.name = fileName.split('.').slice(0, -1).join('.');
        }
        const response: ParseResponse = { type: 'parsed', requestId, fileName, file };
        self.postMessage(response);
    } catch (error) {
        const response: ParseResponse = {
            type: 'error',
            requestId,
            fileName,
            message: error instanceof Error ? error.message : String(error),
        };
        self.postMessage(response);
    }
};

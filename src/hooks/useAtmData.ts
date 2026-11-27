import {useCallback, useEffect, useState} from 'react';
import type {
  ErrorCodesDatabase,
  Guide,
  SchemesDatabase,
  SensorIndex,
} from '../types/atm';
import {ERROR_CODES_URL, GUIDE_SOURCES, SCHEMES_URL} from '../utils/assetPaths';
import {buildIndexes, type ErrorIndexes} from '../utils/errorLookup';
import {parseGuideMarkdown} from '../utils/guideParser';
import {buildSensorIndex} from '../utils/sensorLookup';

export interface AtmDataState {
  status: 'loading' | 'ready' | 'error';
  errorMessage: string | null;
  errorDb: ErrorCodesDatabase | null;
  errorIndexes: ErrorIndexes | null;
  schemesDb: SchemesDatabase | null;
  sensorIndex: SensorIndex | null;
  sensorMinLen: number;
  guides: Guide[];
  reload: () => void;
}

export function useAtmData(): AtmDataState {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDb, setErrorDb] = useState<ErrorCodesDatabase | null>(null);
  const [errorIndexes, setErrorIndexes] = useState<ErrorIndexes | null>(null);
  const [schemesDb, setSchemesDb] = useState<SchemesDatabase | null>(null);
  const [sensorIndex, setSensorIndex] = useState<SensorIndex | null>(null);
  const [sensorMinLen, setSensorMinLen] = useState<number>(2);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [loadSeq, setLoadSeq] = useState(0);

  const reload = useCallback(() => {
    setLoadSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setErrorMessage(null);

    async function fetchAll() {
      try {
        const [errRes, schRes, ...guideResponses] = await Promise.all([
          fetch(ERROR_CODES_URL, {signal: controller.signal}),
          fetch(SCHEMES_URL, {signal: controller.signal}),
          ...GUIDE_SOURCES.map((g) => fetch(g.url, {signal: controller.signal})),
        ]);

        if (!errRes.ok) {
          throw new Error(`Не удалось загрузить базу ошибок (${errRes.status})`);
        }
        if (!schRes.ok) {
          throw new Error(`Не удалось загрузить базу схем (${schRes.status})`);
        }

        const [errJson, schJson, ...guideTexts] = await Promise.all([
          errRes.json() as Promise<ErrorCodesDatabase>,
          schRes.json() as Promise<SchemesDatabase>,
          ...guideResponses.map(async (res, idx) => {
            if (!res.ok) {
              throw new Error(
                `Не удалось загрузить инструкцию ${GUIDE_SOURCES[idx].id.toUpperCase()} (${res.status})`,
              );
            }
            return res.text();
          }),
        ]);

        if (controller.signal.aborted) return;

        const builtErrIndexes = buildIndexes(errJson);
        const builtSensors = buildSensorIndex(schJson);
        const parsedGuides = GUIDE_SOURCES.map((src, idx) =>
          parseGuideMarkdown(src.id, src.subtitle, src.sourceFileName, guideTexts[idx]),
        );

        setErrorDb(errJson);
        setErrorIndexes(builtErrIndexes);
        setSchemesDb(schJson);
        setSensorIndex(builtSensors.index);
        setSensorMinLen(builtSensors.minLen);
        setGuides(parsedGuides);
        setStatus('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        const msg =
          err instanceof Error ? err.message : 'Ошибка загрузки справочных данных';
        setErrorMessage(msg);
        setStatus('error');
      }
    }

    void fetchAll();
    return () => controller.abort();
  }, [loadSeq]);

  return {
    status,
    errorMessage,
    errorDb,
    errorIndexes,
    schemesDb,
    sensorIndex,
    sensorMinLen,
    guides,
    reload,
  };
}

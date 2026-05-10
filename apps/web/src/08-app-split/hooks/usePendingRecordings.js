import { useCallback, useEffect, useState } from 'react';
import {
  deletePendingRecording,
  listPendingRecordings,
  PENDING_EVENT,
  transcribePendingRecording,
  updatePendingRecordingError,
} from '../../09-transcription-pen.js';

export function usePendingRecordings(aiOpts) {
  const [pendingRecordings, setPendingRecordings] = useState([]);
  const [pendingRetryId, setPendingRetryId] = useState(null);
  const [pendingTranscripts, setPendingTranscripts] = useState({});

  const refreshPendingRecordings = useCallback(() => {
    listPendingRecordings()
      .then(setPendingRecordings)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshPendingRecordings();
    window.addEventListener(PENDING_EVENT, refreshPendingRecordings);
    return () => window.removeEventListener(PENDING_EVENT, refreshPendingRecordings);
  }, [refreshPendingRecordings]);

  const retryHeldTranscription = useCallback(async (rec) => {
    if (!aiOpts || pendingRetryId) return;
    setPendingRetryId(rec.id);
    try {
      const txt = await transcribePendingRecording(
        rec.id,
        aiOpts,
        rec.label || "Saved recording"
      );
      setPendingTranscripts(p => ({ ...p, [rec.id]: txt }));
      await updatePendingRecordingError(rec.id, "");
    } catch(e) {
      await updatePendingRecordingError(rec.id, e.message || String(e)).catch(() => {});
    } finally {
      setPendingRetryId(null);
      refreshPendingRecordings();
    }
  }, [aiOpts, pendingRetryId, refreshPendingRecordings]);

  const deleteHeldTranscription = useCallback(async (rec) => {
    if (pendingRetryId === rec.id) return;
    await deletePendingRecording(rec.id);
    setPendingTranscripts(p => {
      const next = { ...p };
      delete next[rec.id];
      return next;
    });
    refreshPendingRecordings();
  }, [pendingRetryId, refreshPendingRecordings]);

  return {
    deleteHeldTranscription,
    pendingRecordings,
    pendingRetryId,
    pendingTranscripts,
    retryHeldTranscription,
  };
}

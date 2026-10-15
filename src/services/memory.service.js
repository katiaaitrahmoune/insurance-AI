import { withTransaction } from '../config/db.js';
import * as memoryModel from '../models/memory.model.js';

export const memoryService = {
  findRelated: (opts) => memoryModel.findRelated(opts),
  forClaim: (claimId) => memoryModel.listForClaim(claimId),
  async save(claimId, rows) {
     console.log("starting memory service")
    if (!rows.length) return 0;
    await withTransaction((db) => memoryModel.insertMemories(db, claimId, rows));
    return rows.length;
  },
};

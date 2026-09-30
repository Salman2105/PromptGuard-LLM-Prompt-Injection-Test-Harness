import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  testId: { type: String, required: true },
  category: { type: String, required: true },
  name: { type: String, required: true },
  timestamp: { type: Date, required: true },
  provider: String,
  model: String,
  isMock: Boolean,
  executionStatus: { type: String, enum: ['completed', 'error'], required: true },
  durationMs: Number,
  errorCode: String,
  responseMetadata: {
    characterCount: Number,
    usage: { input_tokens: Number, output_tokens: Number, total_tokens: Number },
  },
  classification: {
    status: { type: String, enum: ['review', 'not_evaluated'] },
    indicators: [String],
    notes: String,
  },
}, { bufferCommands: false, versionKey: false, strict: 'throw' });

export function createTestResultModel(connection) {
  return connection.model('TestResult', schema);
}

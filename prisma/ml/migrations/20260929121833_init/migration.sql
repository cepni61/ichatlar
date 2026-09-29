-- CreateTable
CREATE TABLE "ModelVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "algorithm" TEXT NOT NULL,
    "trainedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "docCount" INTEGER NOT NULL,
    "vocabSize" INTEGER NOT NULL,
    "accuracy" REAL,
    "params" TEXT NOT NULL,
    "dataFingerprint" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "DepartmentPrior" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "docCount" INTEGER NOT NULL,
    "tokenCount" REAL NOT NULL,
    CONSTRAINT "DepartmentPrior_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TermWeight" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "count" REAL NOT NULL,
    CONSTRAINT "TermWeight_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modelId" TEXT NOT NULL,
    "recordCode" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "corrected" BOOLEAN NOT NULL DEFAULT false,
    "looPredicted" TEXT,
    CONSTRAINT "TrainingSample_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Inference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "modelId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" TEXT,
    "selectedDepartmentId" TEXT,
    "knownTerms" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "predictedDepartmentId" TEXT,
    "confidence" REAL,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Inference_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "ModelVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DepartmentPrediction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inferenceId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "departmentId" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "probability" REAL NOT NULL,
    "terms" TEXT NOT NULL,
    CONSTRAINT "DepartmentPrediction_inferenceId_fkey" FOREIGN KEY ("inferenceId") REFERENCES "Inference" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SimilarityMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inferenceId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "recordCode" TEXT NOT NULL,
    "recordTitle" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "percent" INTEGER NOT NULL,
    "terms" TEXT NOT NULL,
    CONSTRAINT "SimilarityMatch_inferenceId_fkey" FOREIGN KEY ("inferenceId") REFERENCES "Inference" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inferenceId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordCode" TEXT NOT NULL,
    "finalDepartmentId" TEXT NOT NULL,
    "suggestionApplied" BOOLEAN NOT NULL,
    "matchedPrediction" BOOLEAN NOT NULL,
    "forwardedToDepartmentId" TEXT,
    "forwardedAt" DATETIME,
    CONSTRAINT "Outcome_inferenceId_fkey" FOREIGN KEY ("inferenceId") REFERENCES "Inference" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ModelVersion_active_idx" ON "ModelVersion"("active");

-- CreateIndex
CREATE INDEX "ModelVersion_trainedAt_idx" ON "ModelVersion"("trainedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentPrior_modelId_departmentId_key" ON "DepartmentPrior"("modelId", "departmentId");

-- CreateIndex
CREATE INDEX "TermWeight_modelId_term_idx" ON "TermWeight"("modelId", "term");

-- CreateIndex
CREATE UNIQUE INDEX "TermWeight_modelId_term_departmentId_key" ON "TermWeight"("modelId", "term", "departmentId");

-- CreateIndex
CREATE INDEX "TrainingSample_modelId_idx" ON "TrainingSample"("modelId");

-- CreateIndex
CREATE INDEX "TrainingSample_recordCode_idx" ON "TrainingSample"("recordCode");

-- CreateIndex
CREATE INDEX "Inference_createdAt_idx" ON "Inference"("createdAt");

-- CreateIndex
CREATE INDEX "Inference_userId_idx" ON "Inference"("userId");

-- CreateIndex
CREATE INDEX "Inference_predictedDepartmentId_idx" ON "Inference"("predictedDepartmentId");

-- CreateIndex
CREATE INDEX "DepartmentPrediction_inferenceId_idx" ON "DepartmentPrediction"("inferenceId");

-- CreateIndex
CREATE INDEX "DepartmentPrediction_departmentId_idx" ON "DepartmentPrediction"("departmentId");

-- CreateIndex
CREATE INDEX "SimilarityMatch_inferenceId_idx" ON "SimilarityMatch"("inferenceId");

-- CreateIndex
CREATE INDEX "SimilarityMatch_recordCode_idx" ON "SimilarityMatch"("recordCode");

-- CreateIndex
CREATE UNIQUE INDEX "Outcome_inferenceId_key" ON "Outcome"("inferenceId");

-- CreateIndex
CREATE INDEX "Outcome_recordCode_idx" ON "Outcome"("recordCode");

-- CreateIndex
CREATE INDEX "Outcome_createdAt_idx" ON "Outcome"("createdAt");

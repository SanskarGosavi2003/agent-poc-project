// agent.mjs - FINAL version with Retry and Verification
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { GoogleGenerativeAI } from "@google/generative-ai";
import simpleGit from "simple-git";
import dotenv from "dotenv";
import { error } from "console";

dotenv.config();

// --- Main Execution ---
// async function runAgent() {
//   console.log("🤖 Agent starting...");

//   console.log("The LLM key : ", process.env.GEMINI_API_KEY );

//   const targetDir = process.argv[2];
//   if (!targetDir || !fs.existsSync(targetDir)) {
//     console.error("❌ Error: Please provide a valid path to the target repository.");
//     return;
//   }
//   const absoluteTargetDir = path.resolve(targetDir);
//   console.log(`🎯 Targeting repository at: ${absoluteTargetDir}`);

//   const configPath = path.join(absoluteTargetDir, ".guardian.json");
//   if (!fs.existsSync(configPath)) {
//     console.error("❌ Error: Configuration file '.guardian.json' not found.");
//     return;
//   }
//   const config = JSON.parse(safelyReadFile(configPath));
//   console.log(`✅ Loaded configuration for: ${config.repoOwner}/${config.repoName}`);

//   const git = simpleGit(absoluteTargetDir);

//   try {
//     const execOptions = { cwd: absoluteTargetDir };

//     // 1. Run Scans
//     console.log("\n[Step 1] Running Snyk scans...");
//     const scaResult = runCommand("snyk test --json > snyk-dependencies-report.json", execOptions);
//     if (!scaResult.success && scaResult.status !== 1) {
//         throw new Error(`SCA scan truly failed. Aborting.`);
//     }
//     console.log("SCA scan completed.(vulnerabilities may exist)");

//     const sastResult = runCommand("snyk code test --json > snyk-code-report.json", execOptions);
//     if (!sastResult.success && sastResult.status !== 1) {
//         console.warn("SAST scan failed. Proceeding without it.");
//     }
//     console.log("SAST scan completed.(vulnerabilities may exist)");

//     const scaReport = safelyReadFile(path.join(absoluteTargetDir, "snyk-dependencies-report.json"));
//     const sastReport = safelyReadFile(path.join(absoluteTargetDir, "snyk-code-report.json"));

//     // 2. Generate PR Messages
//     console.log("\n[Step 2] Generating commit message and PR body...");
//     const prMessages = await getPrMessages(scaReport, sastReport);
//     if (!prMessages) throw new Error("Failed to generate PR messages from LLM.");
//     const { commitMessage, prBody } = prMessages.json;
//     console.log("Generated Commit Message and PR Body.");

//     // 3. Plan and Execute Dependency Upgrades
//     const dependencyPlan = await getDependencyPlan(scaReport);
//     if (!dependencyPlan?.json?.steps) throw new Error("Failed to generate dependency plan from LLM.");
//     console.log("\n[Step 3] Executing dependency upgrades...");
//     for (const step of dependencyPlan.json.steps) {
//       const cmdResult = runCommand(step.command, execOptions);
//       if (!cmdResult.success && cmdResult.status !== 1) {
//           console.warn(`Warning: Command '${step.command}' may have finished with a non-standard exit code. Continuing...`);
//       }
//     }
//     console.log("✅ Dependency upgrades executed.");

//     // 4. Group and Fix SAST Issues
//     console.log("\n[Step 4] Grouping and fixing SAST issues...");
//     await groupAndFixSastIssues(sastReport, scaReport, absoluteTargetDir);
//     console.log("✅ SAST issues addressed.");

//     // 5. Verification Scan
//     console.log("\n[Step 5] Running verification SAST scan...");
//     const verificationResult = runCommand("snyk code test --json > snyk-verification-report.json", execOptions);
//     if (verificationResult.status === 1) { // Exit code 1 means issues were found
//         throw new Error("Verification failed. SAST issues still remain after remediation.");
//     } else if (!verificationResult.success) { // Any other non-zero exit code
//         throw new Error("Verification SAST scan failed to run.");
//     }
//     console.log("✅ Verification successful! No SAST issues found after remediation.");

//     // 6. Create PR
//     console.log("\n[Step 6] Creating Pull Request...");
//     await createPullRequest(commitMessage, prBody, git, config);

//     console.log("\n--- Remediation POC Finished Successfully ---");

//   } catch (error) {
//     console.error("\n\n❌ A critical error occurred. Aborting the agent's run.");
//     console.error("Error:", error.message);

//     console.log("🔄 Reverting all changes made during this run...");
//     try {
//       await git.reset("hard", ["HEAD"]);
//       await git.clean("f", ["-d"]);
//       console.log("✅ All changes have been reverted.");
//     } catch (revertError) {
//         console.error("🚨 Failed to revert changes. Manual cleanup may be required.", revertError.message);
//     }
//   }
// }

async function runAgent() {
  console.log("🤖 Agent starting...");

  let totalTokensUsed = 0;

  const targetDir = process.argv[2];
  if (!targetDir || !fs.existsSync(targetDir)) {
    console.error(
      "❌ Error: Please provide a valid path to the target repository."
    );
    return;
  }
  const absoluteTargetDir = path.resolve(targetDir);
  console.log(`🎯 Targeting repository at: ${absoluteTargetDir}`);

  const configPath = path.join(absoluteTargetDir, ".guardian.json");
  if (!fs.existsSync(configPath)) {
    console.error("❌ Error: Configuration file '.guardian.json' not found.");
    return;
  }
  const config = JSON.parse(safelyReadFile(configPath));
  console.log(
    `✅ Loaded configuration for: ${config.repoOwner}/${config.repoName}`
  );

  const git = simpleGit(absoluteTargetDir);

  try {
    const execOptions = { cwd: absoluteTargetDir };

    // 1. Run Scans
    console.log("\n[Step 1] Running Snyk scans...");
    console.log(
      "   - Purpose: To generate comprehensive reports on both third-party dependencies (SCA) and the application's own source code (SAST)."
    );
    console.log(
      "   - Expected Result: Two JSON files ('snyk-dependencies-report.json' and 'snyk-code-report.json') containing structured vulnerability data."
    );
    console.log(
      "   - How it will be used: These raw reports will be the primary context for all subsequent LLM calls."
    );
    runCommand("snyk test --json > snyk-dependencies-report.json", execOptions);
    console.log("SCA scan completed.(vulnerabilities may exist)");
    runCommand("snyk code test --json > snyk-code-report.json", execOptions);
    console.log("SAST scan completed.(vulnerabilities may exist)");

    const scaReport = safelyReadFile(
      path.join(absoluteTargetDir, "snyk-dependencies-report.json")
    );
    const sastReport = safelyReadFile(
      path.join(absoluteTargetDir, "snyk-code-report.json")
    );

    const initialCounts = getIssueCounts(scaReport, sastReport);
    console.log(
      `   - Initial Vulnerability Counts: SCA = ${initialCounts.scaCount}, SAST = ${initialCounts.sastCount}`
    );

    // 2. Generate PR Messages
    console.log("\n[Step 2] Generating commit message and PR body...");
    console.log(
      "   - Purpose: To ask the LLM to analyze the raw scan reports and generate a human-readable summary for the final pull request."
    );
    console.log(
      "   - Expected Result: A JSON object containing a concise 'commitMessage' and a detailed 'prBody' in Markdown."
    );
    console.log(
      "   - How it will be used: These values will be used to create the final commit and pull request after all fixes have been applied."
    );
    const prMessagesResult = await getPrMessages(scaReport, sastReport);
    if (!prMessagesResult) throw new Error("Failed to generate PR messages.");
    totalTokensUsed += prMessagesResult.tokens || 0;
    // --- LOGGING FOR PR PLAN ---
    fs.writeFileSync(
      path.join(absoluteTargetDir, "llm_pr_plan.json"),
      prMessagesResult.raw || "{}"
    );
    console.log(
      "✅ LLM PR plan saved to llm_pr_plan.json : \n ",
      prMessagesResult.raw
    );
    let { commitMessage, prBody } = prMessagesResult.json;

    // 3. Plan and Execute Dependency Upgrades
    console.log("\n[Step 3] Planning and executing dependency upgrades...");
    console.log(
      "   - Purpose: To ask the LLM to create an executable plan for upgrading vulnerable dependencies based on the SCA report."
    );
    console.log(
      "   - Expected Result: A JSON object with a 'steps' array, where each step is a command like 'npm install <package>@<version>'."
    );
    console.log(
      "   - How it will be used: The agent will iterate through these steps and execute each command to update the project's dependencies."
    );
    const dependencyPlanResult = await getDependencyPlan(scaReport);
    if (!dependencyPlanResult?.json?.steps)
      throw new Error("Failed to generate dependency plan.");
    totalTokensUsed += dependencyPlanResult.tokens || 0;

    // --- LOGGING FOR DEPENDENCY PLAN ---
    fs.writeFileSync(
      path.join(absoluteTargetDir, "llm_dependency_plan.json"),
      dependencyPlanResult.raw || "{}"
    );
    console.log(
      "✅ LLM dependency plan saved to llm_dependency_plan.json: \n ",
      dependencyPlanResult.raw
    );
    for (const step of dependencyPlanResult.json.steps) {
      runCommand(step.command, execOptions);
    }
    console.log("✅ Dependency upgrades executed.");

    // 4. Group and Fix SAST Issues
    const tokenSASTcount = await groupAndFixSastIssues(
      sastReport,
      scaReport,
      absoluteTargetDir
    );
    totalTokensUsed += tokenSASTcount || 0;

    console.log("\nAuto-formatting modified code...");
    runCommand("npx prettier --write .", execOptions);
    console.log("✅ Code formatting complete.");

    // 5. Verification Scan
    console.log("\n[Step 5] Running verification SAST and SCA scan...");
    console.log(
      "   - Purpose: To confirm that the changes made by the LLM have successfully resolved the vulnerabilities identified in the initial SAST and SCA scan."
    );
    console.log(
      "   - Expected Result: The new SAST and SCA reports contain zero vulnerabilities."
    );
    console.log(
      "   - How it will be used: This acts as a quality gate. If issues remain, the agent will log a warning before proceeding."
    );
    const verificationSASTResult = runCommand(
      "snyk code test --json > snyk-verification-report.json",
      execOptions
    );
    const verificationSCAResult = runCommand(
      "snyk test --json > snyk-verification-sca-report.json",
      execOptions
    );
    if (verificationSASTResult.status === 1) {
      console.log(
        "⚠️ Verification Check: SAST issues still remain after remediation."
      );
    } else if (!verificationSASTResult.success) {
      console.log(
        "❌ Verification SAST scan failed to run. Continuing to PR creation anyway."
      );
    } else {
      console.log(
        "✅ Verification successful! No SAST issues found after remediation."
      );
    }
    if (verificationSCAResult.status === 1) {
      console.log(
        "⚠️ Verification Check: SCA issues still remain after remediation."
      );
    } else if (!verificationSCAResult.success) {
      console.log(
        "❌ Verification SCA scan failed to run. Continuing to PR creation anyway."
      );
    } else {
      console.log(
        "✅ Verification successful! No SCA issues found after remediation."
      );
    }

    const finalScaReport = safelyReadFile(
      path.join(absoluteTargetDir, "snyk-verification-sca-report.json")
    );
    const finalSastReport = safelyReadFile(
      path.join(absoluteTargetDir, "snyk-verification-report.json")
    );

    const finalCounts = getIssueCounts(finalScaReport, finalSastReport);
    console.log("\n--- Remediation Summary ---");
    console.log(
      `   - Initial Vulnerability Counts: SCA = ${initialCounts.scaCount}, SAST = ${initialCounts.sastCount}`
    );
    console.log(
      `   - Final Vulnerability Counts:   SCA = ${finalCounts.scaCount}, SAST = ${finalCounts.sastCount}`
    );

    const remediationAnalysisResult = await getRemediationAnalysis(
      scaReport,
      sastReport,
      finalScaReport,
      finalSastReport
    );
    if (remediationAnalysisResult) {
      totalTokensUsed += remediationAnalysisResult.tokens || 0;
      // --- LOGGING FOR REMEDIATION ANALYSIS ---
      fs.writeFileSync(
        path.join(absoluteTargetDir, "llm_remediation_analysis.json"),
        remediationAnalysisResult.raw || "{}"
      );
      console.log(
        "✅ LLM remediation analysis saved to llm_remediation_analysis.json: \n ",
        remediationAnalysisResult.raw
      );
      const analysis = remediationAnalysisResult.json;
      console.log(`  - Summary: ${analysis.summary}`);
      console.log(
        `  - Improvement Percentage: ${analysis.improvementPercentage}%`
      );
      console.log(
        "  - Fixed Issues:",
        analysis.fixedIssues.length > 0 ? analysis.fixedIssues.length : " None"
      );
      console.log(
        "  - Remaining Issues:",
        analysis.remainingIssues.length > 0 ? analysis.remainingIssues.length : " None"
      );
      console.log(
        "  - New Issues:",
        analysis.newIssues.length > 0 ? analysis.newIssues.length : " None"
      );
      console.log("------------------------------------\n");

      const analysisMarkdown = `
<hr>

## 🤖 Automated Remediation Analysis

**Overall Improvement: ~${analysis.improvementPercentage}%**

${analysis.summary}

### ✅ Fixed Issues
${analysis.fixedIssues.length > 0 ? analysis.fixedIssues.map((f) => `- ${f}`).join("\n") : "No specific fixes identified."}

### ⚠️ Remaining Issues
${analysis.remainingIssues.length > 0 ? analysis.remainingIssues.map((r) => `- ${r}`).join("\n") : "No remaining issues identified."}

### 🚨 New Issues Introduced
${analysis.newIssues.length > 0 ? analysis.newIssues.map((n) => `- ${n}`).join("\n") : "No new issues were introduced."}
      `;

      prBody += analysisMarkdown;
      console.log("✅ Remediation analysis appended to PR body.");
    } else {
      console.log("❌ Failed to generate remediation analysis.");
    }

    // 6. Create PR
    await createPullRequest(commitMessage, prBody, git, config);
  } catch (error) {
    console.error(
      "\n\n❌ A critical error occurred. Aborting the agent's run."
    );
    console.error("Error:", error.message);

    console.log("🔄 Reverting all changes made during this run...");
    try {
      await git.reset("hard", ["HEAD"]);
      await git.clean("f", ["-d"]);
      console.log("✅ All changes have been reverted.");
    } catch (revertError) {
      console.error(
        "🚨 Failed to revert changes. Manual cleanup may be required.",
        revertError.message
      );
    }
  } finally {
    console.log(`\n--- Total LLM Tokens Used: ${totalTokensUsed} ---`);
  }
}

// --- Helper Functions ---

function getIssueCounts(scaReport, sastReport) {
  let scaCount = 0;
  let sastCount = 0;
  try {
    const scaJson = JSON.parse(scaReport || "{}");
    // Standard Snyk test JSON v1 format
    scaCount = scaJson.vulnerabilities?.length || 0;
  } catch (e) {
    console.warn("Could not parse SCA report for counting.");
  }
  try {
    const sastJson = JSON.parse(sastReport || "{}");
    // SARIF format
    sastCount = sastJson.runs?.[0]?.results?.length || 0;
  } catch (e) {
    console.warn("Could not parse SAST report for counting.");
  }
  return { scaCount, sastCount };
}

function safelyReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    console.warn(`Warning: Could not read ${filePath}.`);
    return "";
  }
}

async function getLlmJsonResponse(prompt, schema) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not set.");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-pro",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  // --- NEW: Retry Logic ---
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const rawText = result.response.text();
      const tokenCount = result.response.usageMetadata.totalTokenCount;
      console.log(`Token count: ${tokenCount}`);
      return { json: JSON.parse(rawText), raw: rawText, tokens: tokenCount };
    } catch (error) {
      console.error(`Error on LLM call attempt ${attempt}:`, error.message);
      if (attempt === maxRetries) {
        console.error("LLM call failed after all retries.");
        return null; // Give up after the last attempt
      }
      // Wait for 2 seconds before the next attempt
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// ... (getPrMessages, getDependencyPlan, groupAndFixSastIssues, createPullRequest functions remain unchanged)
async function getPrMessages(scaReport, sastReport) {
  // --- UPDATED, MORE DETAILED PROMPT ---
  const prompt = `
    You are an expert DevSecOps engineer reviewing automated security fixes. Your task is to generate a high-quality commit message and pull request body.

    **Context:**
    1.  **SCA Report (Dependencies):**
        \`\`\`json
        ${scaReport}
        \`\`\`
    2.  **SAST Report (Code):**
        \`\`\`json
        ${sastReport}
        \`\`\`

    **Instructions:**

    1.  **Generate a Commit Message:**
        - It MUST be a single, concise line.
        - It MUST follow the Conventional Commits specification (e.g., "fix(security): Remediate critical vulnerabilities in dependencies and code").
        - Do NOT include a long description in the commit message.

    2.  **Generate a Pull Request Body:**
        - Use Markdown format.
        - Start with a clear, high-level summary of the changes.
        - Create a section titled "## Dependency Upgrades (SCA)" and include a Markdown table listing the vulnerable packages that were upgraded and their version changes (e.g., | Package | From | To |).
        - Create another section titled "## Code-Level Fixes (SAST)" and provide a bulleted list summarizing the vulnerabilities that were fixed in the source code (e.g., "- Fixed a Cross-Site Scripting (XSS) vulnerability in 'index.js' by sanitizing user input.").
        - Conclude with a statement that this PR was generated automatically.

    3.  **Return the final output as a single JSON object with 'commitMessage' and 'prBody'.**
  `;

  const schema = {
    type: "OBJECT",
    properties: {
      commitMessage: { type: "STRING" },
      prBody: { type: "STRING" },
    },
    required: ["commitMessage", "prBody"],
  };

  console.log(
    "🤖 Generating commit message and PR body with a more detailed prompt..."
  );
  return await getLlmJsonResponse(prompt, schema);
}

async function getDependencyPlan(scaReport) {
  const prompt = `Based on this Snyk SCA report, provide a JSON object with a 'steps' array of 'command' types to upgrade the vulnerable dependencies...\n\n${scaReport}`;
  const schema = {
    type: "OBJECT",
    properties: {
      steps: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            type: { type: "STRING" },
            description: { type: "STRING" },
            command: { type: "STRING" },
          },
          required: ["type", "command"],
        },
      },
    },
    required: ["steps"],
  };
  return await getLlmJsonResponse(prompt, schema);
}

async function getRemediationAnalysis(
  initialSca,
  initialSast,
  finalSca,
  finalSast
) {
  const prompt = `
  You are an expert DevSecOps analyst. An automated agent has attempted to fix vulnerabilities.
  Your task is to compare the "before" and "after" Snyk scan reports to provide a holistic analysis of the agent's work.

  **Context:**

  1.  **Initial SCA Report (Dependencies - Before):**
      \`\`\`json
      ${initialSca}
      \`\`\`
  2.  **Initial SAST Report (Code - Before):**
      \`\`\`json
      ${initialSast}
      \`\`\`
  3.  **Final SCA Report (Dependencies - After):**
      \`\`\`json
      ${finalSca}
      \`\`\`
  4.  **Final SAST Report (Code - After):**
      \`\`\`json
      ${finalSast}
      \`\`\`

  **Instructions:**
  Please provide a JSON object analyzing the remediation:
  1.  **summary**: A high-level summary (1-2 sentences) of the remediation effort.
  2.  **fixedIssues**: A string array summarizing the key issues that were successfully fixed (e.g., "Upgraded 'lodash' from 4.17.15 to 4.17.21, fixing a High severity vulnerability.").
  3.  **remainingIssues**: A string array summarizing significant issues that *still* remain.
  4.  **newIssues**: A string array summarizing any *new* vulnerabilities that were introduced (e.g., "Upgrading 'express' introduced a new Medium severity issue.").
  5.  **improvementPercentage**: An estimated percentage (0-100) of how many of the *original* vulnerabilities were resolved.

  Return *only* the JSON object.
  `;

  const schema = {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING" },
      fixedIssues: { type: "ARRAY", items: { type: "STRING" } },
      remainingIssues: { type: "ARRAY", items: { type: "STRING" } },
      newIssues: { type: "ARRAY", items: { type: "STRING" } },
      improvementPercentage: { type: "NUMBER" },
    },
    required: [
      "summary",
      "fixedIssues",
      "remainingIssues",
      "newIssues",
      "improvementPercentage",
    ],
  };

  console.log("🤖 Generating remediation analysis with LLM...");
  return await getLlmJsonResponse(prompt, schema);
}

async function groupAndFixSastIssues(sastReport, scaReport, targetDir) {
  console.log("\n[Step 4] Grouping and fixing SAST issues...");
  console.log(
    "   - Purpose: To ask the LLM to group SAST issues by file and provide fixes, considering recent dependency upgrades."
  );
  console.log(
    "   - Expected Result: Each affected file should be rewritten to fix all its issues, with fixes informed by the SCA report."
  );
  console.log(
    "   - How it will be used: The agent will apply these fixes directly to the source code files in the target repository."
  );
  const sastJson = JSON.parse(sastReport || "{}");
  const issuesByFile = {};
  if (sastJson.runs?.[0]?.results) {
    for (const result of sastJson.runs[0].results) {
      const filePath =
        result.locations[0].physicalLocation.artifactLocation.uri;
      if (!issuesByFile[filePath]) issuesByFile[filePath] = [];
      issuesByFile[filePath].push(result);
    }
  }

  // --- NEW: Parallel Batch Processing ---
  let totalTokenCount = 0;
  const filePaths = Object.keys(issuesByFile);
  const chunkSize = 10; // Process 10 files concurrently
  for (let i = 0; i < filePaths.length; i += chunkSize) {
    const chunk = filePaths.slice(i, i + chunkSize);
    console.log(`\n--- Processing batch of ${chunk.length} files... ---`);

    const promises = chunk.map(async (filePath) => {
      const fullFilePath = path.join(targetDir, filePath);
      const issues = issuesByFile[filePath];
      console.log(`  - Fixing ${issues.length} issue(s) in ${filePath}`);

      const fileContent = safelyReadFile(fullFilePath);
      if (!fileContent) {
        console.warn(`    Could not read ${filePath}, skipping.`);
        return;
      }

      const codeFixPrompt = `A SAST scan found vulnerabilities in '${filePath}':\n${JSON.stringify(issues, null, 2)}\n\nProject dependencies were updated based on:\n${scaReport}\n\nFull file content:\n\n${fileContent}\n\nPlease provide a JSON object with a 'newContent' field containing the complete, rewritten file.`;
      const codeFixSchema = {
        type: "OBJECT",
        properties: { newContent: { type: "STRING" } },
        required: ["newContent"],
      };
      const codeFixResult = await getLlmJsonResponse(
        codeFixPrompt,
        codeFixSchema
      );
      totalTokenCount += codeFixResult?.tokens || 0;

      // FIX: Save log files to the target directory
      const sanitizedLogFileName = `llm_codefix_${filePath.replace(/[\\/.]/g, "_")}.json`;
      fs.writeFileSync(
        path.join(targetDir, sanitizedLogFileName),
        codeFixResult?.raw || "{}"
      );
      console.log(`    ✅ LLM plan for ${filePath} saved.`);

      if (codeFixResult?.json?.newContent) {
        fs.writeFileSync(fullFilePath, codeFixResult.json.newContent);
        console.log(`    ✅ Modified file: ${fullFilePath}`);
      } else {
        throw new Error(`LLM failed to provide a fix for ${filePath}.`);
      }
    });

    await Promise.all(promises); // Wait for the current batch to complete
  }
  return totalTokenCount;
}

async function createPullRequest(commitMessage, prBody, git, config) {
  console.log("\n[Step 6] Creating Pull Request...");
  console.log(
    "   - Purpose: To create a new branch, commit all the automated changes, and open a pull request on GitHub for human review."
  );
  console.log(
    "   - Expected Result: A new pull request in the target repository containing all the fixes."
  );
  console.log(
    "   - How it will be used: This is the final step, delivering the completed work to the development team."
  );
  if (!process.env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN not set.");

  const branchName = `guardian/remediate-${Date.now()}`;
  // Use values from the config file
  const { repoOwner, repoName, defaultBranch } = config;

  await git.addConfig("user.name", "Guardian Agent");
  await git.addConfig("user.email", "agent@example.com");
  await git.checkoutLocalBranch(branchName);
  await git.add("./*");
  await git.commit(commitMessage);
  await git.push("origin", branchName, ["--set-upstream"]);
  console.log(`✅ Pushed changes to new branch: ${branchName}`);

  const prResponse = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        title: commitMessage,
        head: branchName,
        base: defaultBranch,
        body: prBody,
      }),
    }
  );

  if (prResponse.ok) {
    const prData = await prResponse.json();
    console.log(`✅ Successfully created Pull Request: ${prData.html_url}`);
  } else {
    throw new Error(
      `Failed to create pull request: ${await prResponse.text()}`
    );
  }
  await git.checkout(defaultBranch);
}

function runCommand(command, options) {
  console.log(`\n[EXEC] ---------------------------------`);
  console.log(`[EXEC] Running command: ${command}`);
  console.log(`[EXEC] In directory: ${options.cwd}`);
  console.log(`[EXEC] ---------------------------------`);
  try {
    // Use stdio: 'pipe' to capture output for logging, inherit would print directly
    const output = execSync(command, { ...options, encoding: "utf8" });
    console.log("[EXEC] Output:\n", output);
    return { success: true, output };
  } catch (error) {
    console.error(`[EXEC] Error running command: ${command}`);
    console.error(`[EXEC] Exit Code: ${error.status}`);
    console.error(`[EXEC] STDOUT:\n${error.stdout}`);
    console.error(`[EXEC] STDERR:\n${error.stderr}`);
    // Return the status so the caller can decide how to handle it
    return {
      success: false,
      status: error.status,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

runAgent();

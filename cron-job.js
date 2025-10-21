// cron-job.js
import cron from 'node-cron';
import { exec, execSync } from 'child_process';
import path from 'path';

console.log('Cron job started. Waiting for the scheduled task...');
const agentScriptPath = path.resolve('agent.js');
const targetRepoPath = path.resolve('../agent-poc-target');
execSync(`node ${agentScriptPath} ${targetRepoPath}`, { stdio: 'inherit' });

// Schedule the agent to run every 6 hours.
// You can change the schedule using cron syntax (e.g., '*/30 * * * *' for every 30 mins).
// cron.schedule('0 */21 * * * *', () => {
//   console.log(`\n[${new Date().toISOString()}] Triggering the Guardian Agent...`);
  
//   // Define the path to your agent script and the target directory
//   const agentScriptPath = path.resolve('agent.js');
//   const targetRepoPath = path.resolve('../agent-poc-target');

//   try {
//     // Execute the agent script, passing the target directory as an argument
//     execSync(`node ${agentScriptPath} ${targetRepoPath}`, { stdio: 'inherit' });
//     console.log(`[${new Date().toISOString()}] Agent run completed successfully.`);
//   } catch (error) {
//     console.error(`[${new Date().toISOString()}] An error occurred during the agent's run:`, error.message);
//   }
// });
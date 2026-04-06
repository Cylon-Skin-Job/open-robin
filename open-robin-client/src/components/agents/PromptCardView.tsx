/**
 * PromptCardView — renders workflow files as step cards with detail panel.
 *
 * Workflow files: two-panel view (step cards left, detail right)
 * Non-workflow files: plain pre/code display
 */

import { useState, type ReactElement } from 'react';
import { CodeView } from '../CodeView';
import './prompt-cards.css';

interface PromptCardViewProps {
  content: string;
  fileName: string;
  agentColor?: string;
}

interface WorkflowStep {
  number?: number;
  title: string;
  summary: string;
  fullContent: string;
}

interface WorkflowData {
  heading: string;
  description: string;
  steps: WorkflowStep[];
}

function parseWorkflow(content: string): WorkflowData {
  const lines = content.split('\n');
  let i = 0;

  // Skip frontmatter
  if (lines[0]?.trim() === '---') {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== '---') i++;
    i++;
  }

  let heading = '';
  let description = '';
  const steps: WorkflowStep[] = [];
  let currentStep: { number?: number; title: string; lines: string[] } | null = null;

  // Collect description lines (between # heading and first ### step)
  const descLines: string[] = [];
  let inDesc = false;

  while (i < lines.length) {
    const line = lines[i];

    // # Heading
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      heading = line.slice(2).trim();
      inDesc = true;
      i++;
      continue;
    }

    // ## Section headers (like "## Steps") — skip them
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      inDesc = false;
      i++;
      continue;
    }

    // ### Step
    if (line.startsWith('### ')) {
      inDesc = false;
      if (currentStep) {
        steps.push(buildStep(currentStep));
      }
      const title = line.slice(4).trim();
      const stepMatch = title.match(/^(\d+)\.\s*(.*)/);
      currentStep = {
        number: stepMatch ? parseInt(stepMatch[1]) : undefined,
        title: stepMatch ? stepMatch[2] : title,
        lines: [],
      };
      i++;
      continue;
    }

    if (inDesc) {
      descLines.push(line);
    } else if (currentStep) {
      currentStep.lines.push(line);
    }

    i++;
  }

  if (currentStep) {
    steps.push(buildStep(currentStep));
  }

  description = descLines.join('\n').trim();

  return { heading, description, steps };
}

function buildStep(raw: { number?: number; title: string; lines: string[] }): WorkflowStep {
  const full = raw.lines.join('\n').trim();
  // Summary: first sentence or first 120 chars
  const firstSentence = full.match(/^([^.!?\n]+[.!?])/);
  const summary = firstSentence ? firstSentence[1] : full.slice(0, 120) + (full.length > 120 ? '...' : '');

  return {
    number: raw.number,
    title: raw.title,
    summary,
    fullContent: full,
  };
}

function isWorkflowFile(fileName: string): boolean {
  // Workflow files are anything that isn't a known agent config file
  if (!fileName) return false;
  const configNames = ['PROMPT', 'MEMORY', 'LESSONS', 'SESSION', 'TRIGGERS', 'HISTORY'];
  const base = fileName.replace('.md', '');
  return !configNames.includes(base);
}

function renderFullContent(content: string): ReactElement {
  const lines = content.split('\n');
  return (
    <>
      {lines.map((line, i) => {
        if (line.match(/^evaluate:/i)) {
          return (
            <div key={i} className="wf-evaluate">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>checklist</span>
              <span className="wf-evaluate-label">Evaluate:</span>
              <span>{line.replace(/^evaluate:\s*/i, '')}</span>
            </div>
          );
        }
        if (line.match(/instruct\s*(it\s*)?to:/i)) {
          return <div key={i} className="wf-instruct-label">{line}</div>;
        }
        if (line.trim().startsWith('- ')) {
          return (
            <div key={i} className="wf-bullet">
              <span className="wf-bullet-dot" />
              {line.trim().slice(2)}
            </div>
          );
        }
        if (line.trim() === '') {
          return <div key={i} style={{ height: '8px' }} />;
        }
        return <div key={i} className="wf-text-line">{line}</div>;
      })}
    </>
  );
}

export function PromptCardView({ content, fileName, agentColor }: PromptCardViewProps) {
  const [activeStep, setActiveStep] = useState(0);

  if (!isWorkflowFile(fileName)) {
    const ext = fileName.split('.').pop()?.toLowerCase();
    return <CodeView content={content} extension={ext} />;
  }

  const workflow = parseWorkflow(content);

  return (
    <div className="wf-container" style={{ '--agent-color': agentColor } as React.CSSProperties}>
      {/* Steps panel — heading/description shown on sidebar card, not repeated here */}
      <div className="wf-panels">
        {/* Left: step cards */}
        <div className="wf-step-list">
          {workflow.steps.map((step, i) => (
            <div key={i}>
              {i > 0 && <div className="wf-connector" />}
              <div
                className={`wf-step-card${i === activeStep ? ' active' : ''}`}
                onClick={() => setActiveStep(i)}
              >
                {step.number && <div className="wf-step-num">{step.number}</div>}
                <div className="wf-step-info">
                  <div className="wf-step-title">{step.title}</div>
                  <div className="wf-step-summary">{step.summary}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Connector line from active card to detail */}
        <div className="wf-bridge">
          <div className="wf-bridge-line" />
        </div>

        {/* Right: full detail of selected step */}
        <div className="wf-detail">
          {workflow.steps[activeStep] && (
            <>
              <div className="wf-detail-title">
                {workflow.steps[activeStep].number && (
                  <span className="wf-detail-num">{workflow.steps[activeStep].number}.</span>
                )}
                {workflow.steps[activeStep].title}
              </div>
              <div className="wf-detail-body">
                {renderFullContent(workflow.steps[activeStep].fullContent)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

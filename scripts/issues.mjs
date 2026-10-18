import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
if ([...args].some((arg) => !['--dry-run', '--update-existing', '--help'].includes(arg))) throw new Error('Unknown option')
if (args.has('--help')) {
  console.log('node scripts/issues.mjs [--dry-run] [--update-existing]\nDefault creates missing issues only. Updates preserve assignees/milestones/labels. F16 is closed as not planned.')
  process.exit(0)
}
const repo = process.env.REPO || 'vkyphong/mid_term_web_application'
if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('REPO must be owner/name')
const manifest = JSON.parse(readFileSync(resolve(root, 'docs/backlog/manifest.json'), 'utf8'))
const planned = manifest.map((item) => ({ ...item, body: readFileSync(resolve(root, `docs/backlog/${item.id}.md`), 'utf8') }))
if (args.has('--dry-run')) {
  for (const item of planned) console.log(`${item.id} | ${item.title} | ${item.outOfScope ? 'CLOSE not_planned' : 'create/update'}\n${item.body}\n`)
  process.exit(0)
}
function gh(...params) {
  const result = spawnSync('gh', params, { encoding: 'utf8', cwd: root })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return result.stdout.trim()
}
const existing = JSON.parse(gh('issue', 'list', '--repo', repo, '--state', 'all', '--limit', '1000', '--json', 'number,title,state,body,assignees,milestone,labels'))
const snapshots = resolve(root, '.local/issue-backups')
mkdirSync(snapshots, { recursive: true })
writeFileSync(resolve(snapshots, `${new Date().toISOString().replaceAll(':', '-')}.json`), JSON.stringify(existing, null, 2))
// Validate all sources and required owners before any write.
for (const item of planned) {
  const found = existing.filter((issue) => issue.title.startsWith(`[${item.id}] `))
  if (found.length > 1) throw new Error(`Duplicate ${item.id}; resolve manually before sync`)
  if (!found.length && !item.outOfScope && !process.env[item.owner]) throw new Error(`Set ${item.owner} to create ${item.id}`)
}
let labels = JSON.parse(gh('label', 'list', '--repo', repo, '--limit', '1000', '--json', 'name')).map((x) => x.name)
const milestoneData = JSON.parse(gh('api', `repos/${repo}/milestones?state=all&per_page=100`))
for (const item of planned) {
  const issue = existing.find((issue) => issue.title.startsWith(`[${item.id}] `))
  if (issue) {
    if (!args.has('--update-existing')) { console.log(`SKIP ${item.id} #${issue.number}`); continue }
    if (issue.body !== item.body || issue.title !== item.title) {
      gh('issue', 'edit', String(issue.number), '--repo', repo, '--title', item.title, '--body-file', resolve(root, `docs/backlog/${item.id}.md`))
    }
    if (item.outOfScope && issue.state === 'OPEN') gh('issue', 'close', String(issue.number), '--repo', repo, '--reason', 'not planned')
    console.log(`SYNC ${item.id} #${issue.number}${item.outOfScope ? ' (out of scope)' : ''}`)
    continue
  }
  if (item.outOfScope) { console.log(`SKIP ${item.id}: out of scope`); continue }
  for (const label of item.labels) {
    if (!labels.includes(label)) { gh('label', 'create', label, '--repo', repo, '--color', 'BFD4F2'); labels.push(label) }
  }
  let milestone = milestoneData.find((x) => x.title === item.milestone)
  if (!milestone) {
    milestone = JSON.parse(gh('api', '--method', 'POST', `repos/${repo}/milestones`, '--raw-field', `title=${item.milestone}`))
    milestoneData.push(milestone)
  }
  if (milestone.state !== 'open') throw new Error(`Milestone ${item.milestone} is closed`)
  console.log(gh('issue', 'create', '--repo', repo, '--title', item.title, '--body-file', resolve(root, `docs/backlog/${item.id}.md`),
    '--assignee', process.env[item.owner], '--label', item.labels.join(','), '--milestone', item.milestone))
}
console.log('Done. Existing ownership, milestones, labels and review checkboxes were preserved from source. Backup: .local/issue-backups/')

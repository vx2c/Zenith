'use strict';

// Maps mutating tools to a concrete read-back operation. A successful write
// is only evidence that Studio accepted the command; it is not task evidence.

const READ_TOOLS = new Set([
  'read_script', 'get_tree', 'find_instances', 'get_properties',
  'get_attributes', 'search_scripts', 'get_selection', 'get_output_logs',
  'analyze_project', 'summarize_project', 'detect_systems', 'ping',
]);

function unwrapToolResult(result) {
  if (!result || typeof result !== 'object') return result;
  if (result.success === true && result.data && typeof result.data === 'object') {
    return result.data;
  }
  return result;
}

function buildVerification(toolName, args = {}, result) {
  if (READ_TOOLS.has(toolName)) return null;

  const data = unwrapToolResult(result);
  const path = typeof data?.path === 'string'
    ? data.path
    : args.parent && args.name
      ? `${args.parent}.${args.name}`
      : args.path;

  switch (toolName) {
    case 'create_script':
    case 'create_module':
    case 'update_script':
    case 'append_script':
    case 'format_script':
      return {
        toolName,
        writeArgs: { ...args },
        tool: 'read_script',
        args: { path },
        expectedPath: path,
        expectedSource: typeof args.source === 'string' ? args.source : null,
        mode: toolName === 'append_script' ? 'contains' : 'source',
      };
    case 'set_properties':
      return { toolName, writeArgs: { ...args }, tool: 'get_properties', args: { path }, expectedPath: path, expected: args.properties || {} };
    case 'set_attributes':
      return { toolName, writeArgs: { ...args }, tool: 'get_attributes', args: { path }, expectedPath: path, expected: args.attributes || {} };
    case 'create_instance':
    case 'create_gui':
    case 'create_ui_element':
    case 'update_ui_element':
    case 'create_part':
    case 'create_model':
    case 'create_spawn':
    case 'create_remote_event':
    case 'create_remote_function':
    case 'create_folder':
      return { toolName, writeArgs: { ...args }, tool: 'get_tree', args: { path, maxDepth: 6, maxNodes: 500 }, expectedPath: path };
    case 'rename_instance':
    case 'move_instance':
    case 'clone_instance':
      return { toolName, writeArgs: { ...args }, tool: 'find_instances', args: { query: args.name || path?.split('.').pop(), maxResults: 20 }, expectedPath: path };
    case 'delete_instance':
      return { toolName, writeArgs: { ...args }, tool: 'get_tree', args: { path: path?.split('.').slice(0, -1).join('.'), maxDepth: 2, maxNodes: 100 }, expectedPath: path, mode: 'absent' };
    default:
      return null;
  }
}

function sameValue(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function verifyReadback(verification, result) {
  if (!verification || !result || result.error) return false;
  const data = unwrapToolResult(result);
  if (!data || typeof data !== 'object') return false;

  if (verification.tool === 'read_script') {
    if (data.path !== verification.expectedPath || typeof data.source !== 'string') return false;
    return verification.mode === 'contains'
      ? data.source.includes(verification.expectedSource || '')
      : verification.toolName === 'format_script' || data.source === verification.expectedSource;
  }

  if (verification.tool === 'get_properties') {
    if (data.path !== verification.expectedPath) return false;
    return Object.entries(verification.expected || {}).every(([key, value]) => sameValue(data.properties?.[key], value));
  }

  if (verification.tool === 'get_attributes') {
    if (data.path !== verification.expectedPath) return false;
    return Object.entries(verification.expected || {}).every(([key, value]) => sameValue(data.attributes?.[key], value));
  }

  if (verification.tool === 'find_instances') {
    const serialized = JSON.stringify(data.results || data);
    return serialized.includes(verification.expectedPath?.split('.').pop() || '');
  }

  if (verification.tool === 'get_tree') {
    if (verification.mode === 'absent') return !JSON.stringify(data).includes(verification.expectedPath || '');
    return data.root === verification.expectedPath || data.path === verification.expectedPath;
  }

  return false;
}

module.exports = { buildVerification, verifyReadback, unwrapToolResult };

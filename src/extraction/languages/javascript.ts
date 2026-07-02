import type { Node as SyntaxNode } from 'web-tree-sitter';
import { getNodeText, getChildByField } from '../tree-sitter-helpers';
import type { LanguageExtractor, ExtractorContext } from '../tree-sitter-types';

export const javascriptExtractor: LanguageExtractor = {
  functionTypes: ['function_declaration', 'arrow_function', 'function_expression'],
  classTypes: ['class_declaration'],
  methodTypes: ['method_definition', 'field_definition'],
  interfaceTypes: [],
  structTypes: [],
  enumTypes: [],
  typeAliasTypes: [],
  importTypes: ['import_statement'],
  callTypes: ['call_expression'],
  variableTypes: ['lexical_declaration', 'variable_declaration'],
  nameField: 'name',
  bodyField: 'body',
  resolveBody: (node, bodyField) => {
    // field_definition (arrow function class fields) nest the body inside
    // an arrow_function or function_expression child:
    //   field_definition → arrow_function → body (statement_block)
    // Also handles wrapper patterns like: field = throttle((e) => { ... })
    //   field_definition → call_expression → arguments → arrow_function → body
    if (node.type === 'field_definition') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (!child) continue;
        if (child.type === 'arrow_function' || child.type === 'function_expression') {
          return getChildByField(child, bodyField);
        }
        if (child.type === 'call_expression') {
          const args = getChildByField(child, 'arguments');
          if (args) {
            for (let j = 0; j < args.namedChildCount; j++) {
              const arg = args.namedChild(j);
              if (arg && (arg.type === 'arrow_function' || arg.type === 'function_expression')) {
                return getChildByField(arg, bodyField);
              }
            }
          }
        }
      }
    }
    return null;
  },
  paramsField: 'parameters',
  getSignature: (node, source) => {
    const params = getChildByField(node, 'parameters');
    return params ? getNodeText(params, source) : undefined;
  },
  isExported: (node, _source) => {
    let current = node.parent;
    while (current) {
      if (current.type === 'export_statement') return true;
      current = current.parent;
    }
    return false;
  },
  isAsync: (node) => {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.type === 'async') return true;
    }
    return false;
  },
  isConst: (node) => {
    if (node.type === 'lexical_declaration') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child?.type === 'const') return true;
      }
    }
    return false;
  },
  visitNode: owlVisitNode,

  extractImport: (node, source) => {
    const sourceField = node.childForFieldName('source');
    if (sourceField) {
      const moduleName = source.substring(sourceField.startIndex, sourceField.endIndex).replace(/['"]/g, '');
      if (moduleName) {
        return { moduleName, signature: source.substring(node.startIndex, node.endIndex).trim() };
      }
    }
    return null;
  },
};

// ---------------------------------------------------------------------------
// OWL visitNode — shared by javascript + typescript extractors
// ---------------------------------------------------------------------------

export function owlVisitNode(node: SyntaxNode, ctx: ExtractorContext): boolean {
  const fromNodeId = ctx.nodeStack[ctx.nodeStack.length - 1];
  if (!fromNodeId) return false;
  const line = node.startPosition.row + 1;

  // static template = "module.Template" inside OWL Component class
  if (node.type === 'field_definition') {
    const nameNode = getChildByField(node, 'name');
    const valueNode = getChildByField(node, 'value');
    if (nameNode && valueNode && getNodeText(nameNode, ctx.source) === 'template') {
      if (valueNode.type === 'string') {
        const templateName = getNodeText(valueNode, ctx.source).replace(/['"]/g, '');
        if (templateName) {
          ctx.addUnresolvedReference({
            fromNodeId,
            referenceName: `qweb::${templateName}`,
            referenceKind: 'references',
            line,
            column: node.startPosition.column,
            filePath: ctx.filePath,
            language: 'javascript',
          });
        }
      }
    }
    return false;
  }

  // call_expression: patch(Target, {...}) or registry.category(...).add(name, Comp)
  if (node.type === 'call_expression') {
    const funcNode = getChildByField(node, 'function');
    const argsNode = getChildByField(node, 'arguments');
    if (!funcNode || !argsNode) return false;
    const funcText = getNodeText(funcNode, ctx.source);

    // patch(TargetClass, { ... })
    if (funcText === 'patch') {
      const firstArg = argsNode.namedChildren[0];
      if (firstArg) {
        ctx.addUnresolvedReference({
          fromNodeId,
          referenceName: getNodeText(firstArg, ctx.source),
          referenceKind: 'references',
          line,
          column: node.startPosition.column,
          filePath: ctx.filePath,
          language: 'javascript',
        });
      }
      return false;
    }

    // registry.category("views").add("list", ListView)
    if (/\.add$/.test(funcText)) {
      const args = argsNode.namedChildren;
      if (args.length >= 2) {
        const compArg = args[1]!;
        const compName = getNodeText(compArg, ctx.source);
        if (/^[A-Z]/.test(compName)) {
          ctx.addUnresolvedReference({
            fromNodeId,
            referenceName: compName,
            referenceKind: 'references',
            line,
            column: node.startPosition.column,
            filePath: ctx.filePath,
            language: 'javascript',
          });
        }
      }
    }

    // T2-T: useService('service_name') → service ref
    if (funcText === 'useService') {
      const firstArg = argsNode.namedChildren[0];
      if (firstArg?.type === 'string') {
        const serviceName = getNodeText(firstArg, ctx.source).replace(/['"]/g, '');
        if (serviceName) {
          ctx.addUnresolvedReference({
            fromNodeId,
            referenceName: `service::${serviceName}`,
            referenceKind: 'references',
            line,
            column: node.startPosition.column,
            filePath: ctx.filePath,
            language: 'javascript',
          });
        }
      }
    }

    // 5.1: orm.call('res.partner', 'search', ...) → model + method refs
    if (/\borm\.call$/.test(funcText)) {
      const [modelArg, methodArg] = argsNode.namedChildren;
      if (modelArg?.type === 'string') {
        const model = getNodeText(modelArg, ctx.source).replace(/['"]/g, '');
        if (model) ctx.addUnresolvedReference({ fromNodeId, referenceName: model, referenceKind: 'references', line, column: node.startPosition.column, filePath: ctx.filePath, language: 'javascript' });
      }
      if (methodArg?.type === 'string') {
        const method = getNodeText(methodArg, ctx.source).replace(/['"]/g, '');
        if (method) ctx.addUnresolvedReference({ fromNodeId, referenceName: method, referenceKind: 'references', line, column: node.startPosition.column, filePath: ctx.filePath, language: 'javascript' });
      }
    }

    // 5.2: orm.searchRead('res.partner', ['field1', 'field2']) → model + field refs
    if (/\borm\.searchRead$/.test(funcText)) {
      const [modelArg, fieldsArg] = argsNode.namedChildren;
      if (modelArg?.type === 'string') {
        const model = getNodeText(modelArg, ctx.source).replace(/['"]/g, '');
        if (model) ctx.addUnresolvedReference({ fromNodeId, referenceName: model, referenceKind: 'references', line, column: node.startPosition.column, filePath: ctx.filePath, language: 'javascript' });
      }
      if (fieldsArg?.type === 'array') {
        for (const el of fieldsArg.namedChildren) {
          if (el.type === 'string') {
            const field = getNodeText(el, ctx.source).replace(/['"]/g, '');
            if (field) ctx.addUnresolvedReference({ fromNodeId, referenceName: field, referenceKind: 'references', line, column: node.startPosition.column, filePath: ctx.filePath, language: 'javascript' });
          }
        }
      }
    }

    // 5.3: doAction({res_model: 'X'}) / 5.4: loadViews({model: 'X'}) → model ref
    if (/\b(?:doAction|do_action|loadViews)$/.test(funcText)) {
      const firstArg = argsNode.namedChildren[0];
      if (firstArg?.type === 'object') {
        for (const prop of firstArg.namedChildren) {
          if (prop.type === 'pair') {
            const keyNode = prop.childForFieldName?.('key') ?? prop.namedChildren[0];
            const valNode = prop.childForFieldName?.('value') ?? prop.namedChildren[1];
            if (keyNode && valNode) {
              const keyText = getNodeText(keyNode, ctx.source).replace(/['"]/g, '');
              if ((keyText === 'res_model' || keyText === 'model') && valNode.type === 'string') {
                const modelName = getNodeText(valNode, ctx.source).replace(/['"]/g, '');
                if (modelName) ctx.addUnresolvedReference({ fromNodeId, referenceName: modelName, referenceKind: 'references', line, column: node.startPosition.column, filePath: ctx.filePath, language: 'javascript' });
              }
            }
          }
        }
      }
    }

    return false;
  }

  return false;
}

/**
 * Unit tests for src/extraction/odoo-extractor.ts
 * Covers: menuitem attrs, label for, field text content, filter nodes,
 * field groups attr, embedded Python, act_window, function tag, xpath refs,
 * ir.sequence/config_param dual nodes, domain field refs, context defaults,
 * eval ref() patterns, t-field, t-on-* arch patterns.
 */

import { describe, it, expect } from 'vitest';
import { OdooExtractor } from '../src/extraction/odoo-extractor';

function extract(source: string, filePath = 'data/test.xml') {
  return new OdooExtractor(filePath, source).extract();
}

function refNames(source: string, filePath = 'data/test.xml'): string[] {
  return extract(source, filePath).unresolvedReferences.map((r) => r.referenceName);
}

function nodeQNames(source: string, filePath = 'data/test.xml'): string[] {
  return extract(source, filePath).nodes.map((n) => n.qualifiedName ?? n.name);
}

// ---------------------------------------------------------------------------
// Spec 2.1 — menuitem attribute refs
// ---------------------------------------------------------------------------

describe('OdooExtractor — menuitem attribute refs (spec 2.1)', () => {
  it('emits action, parent, and groups refs', () => {
    const src = `<odoo>
  <menuitem id="menu_tipo_detraccion"
            action="tipo_detraccion_action"
            parent="account.menu_finance"
            groups="account.group_account_user"/>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('tipo_detraccion_action');
    expect(r).toContain('account.menu_finance');
    expect(r).toContain('account.group_account_user');
  });

  it('uses parent attribute (not parent_id)', () => {
    const src = `<odoo>
  <menuitem id="menu_test" parent="account.root_menu" parent_id="should.not.emit"/>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('account.root_menu');
    // parent_id is NOT a recognized refAttr — must not appear
    expect(r).not.toContain('should.not.emit');
  });

  it('menuitem with only action → emits action ref', () => {
    const src = `<odoo>
  <menuitem id="menu_simple" action="my_action"/>
</odoo>`;
    expect(refNames(src)).toContain('my_action');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.2 — <label for="X"> arch field ref
// ---------------------------------------------------------------------------

describe('OdooExtractor — label for field ref (spec 2.2)', () => {
  it('<label for="field_name"/> emits field ref', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_form">
    <field name="arch" type="xml">
      <form>
        <label for="is_detraction"/>
        <field name="is_detraction"/>
      </form>
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('is_detraction');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.4 — <field name="res_model">model.name</field> text content
// ---------------------------------------------------------------------------

describe('OdooExtractor — field text content model ref (spec 2.4)', () => {
  it('<field name="res_model"> text → model ref', () => {
    const src = `<odoo>
  <record model="ir.actions.act_window" id="action_detraccion">
    <field name="res_model">account.detraction</field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('account.detraction');
  });

  it('<field name="model"> text → model ref', () => {
    const src = `<odoo>
  <record model="ir.actions.report" id="report_inv">
    <field name="model">account.move</field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('account.move');
  });

  it('<field name="model_name"> text → model ref', () => {
    const src = `<odoo>
  <record model="ir.sequence" id="seq_detraccion">
    <field name="model_name">account.detraction</field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('account.detraction');
  });

  it('plain text without dots does NOT emit ref', () => {
    const src = `<odoo>
  <record model="ir.actions.act_window" id="action_test">
    <field name="res_model">nodot</field>
  </record>
</odoo>`;
    expect(refNames(src)).not.toContain('nodot');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.5 — <filter> nodes in search arch
// ---------------------------------------------------------------------------

describe('OdooExtractor — filter nodes (spec 2.5)', () => {
  it('<filter name="X"> emits ir.filters::X node', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_search">
    <field name="arch" type="xml">
      <search>
        <filter name="group_by_anexo" string="By Annex"/>
      </search>
    </field>
  </record>
</odoo>`;
    expect(nodeQNames(src).some((n) => n.includes('ir.filters::group_by_anexo'))).toBe(true);
  });

  it('<filter context group_by> emits field ref for the grouped field', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_search">
    <field name="arch" type="xml">
      <search>
        <filter name="by_anexo" context="{'group_by': 'anexo'}"/>
      </search>
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('anexo');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.6 — <field groups="X"/> arch ref
// ---------------------------------------------------------------------------

describe('OdooExtractor — arch field groups attr (spec 2.6)', () => {
  it('<field groups="X"/> emits group ref', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_form">
    <field name="arch" type="xml">
      <form>
        <field name="amount" groups="account.group_account_user"/>
      </form>
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('account.group_account_user');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.7 — embedded Python in <field name="code">
// ---------------------------------------------------------------------------

describe('OdooExtractor — embedded Python in code field (spec 2.7)', () => {
  it('env.ref(...) inside server action code field → xml_id ref', () => {
    const src = `<odoo>
  <record model="ir.actions.server" id="server_action_detraccion">
    <field name="code">
env.ref('l10n_pe.action_template').write({})
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('l10n_pe.action_template');
  });

  it("self.env['model'] inside cron code field → model ref", () => {
    const src = `<odoo>
  <record model="ir.cron" id="cron_detraccion">
    <field name="code">
records = self.env['account.detraction'].search([])
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('account.detraction');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.8 — act_window src_model + report model/file
// ---------------------------------------------------------------------------

describe('OdooExtractor — act_window src_model ref (spec 2.8)', () => {
  it('<act_window src_model="M"/> emits model ref', () => {
    const src = `<odoo>
  <act_window id="action_from_partner"
              src_model="res.partner"
              res_model="account.detraction"/>
</odoo>`;
    expect(refNames(src)).toContain('res.partner');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.9 — <function model="M" name="N">
// ---------------------------------------------------------------------------

describe('OdooExtractor — function tag refs (spec 2.9)', () => {
  it('<function model="M" name="N"> emits model ref and method ref', () => {
    const src = `<odoo>
  <function model="res.partner" name="write">
    <value eval="{}"/>
  </function>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('res.partner');
    expect(r).toContain('write');
  });
});

// ---------------------------------------------------------------------------
// Spec 2.10 — <xpath expr="//field[@name='X']"> refs
// ---------------------------------------------------------------------------

describe('OdooExtractor — xpath attr refs (spec 2.10)', () => {
  it('//field[@name=\'X\'] in xpath expr → field ref', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_inherit">
    <field name="arch" type="xml">
      <xpath expr="//field[@name='partner_id']" position="after">
        <field name="is_detraction"/>
      </xpath>
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('partner_id');
  });

  it('//button[@name=\'X\'] in xpath expr → method ref', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_inherit">
    <field name="arch" type="xml">
      <xpath expr="//button[@name='action_post']" position="before">
        <button name="action_draft"/>
      </xpath>
    </field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('action_post');
  });

  it('[@id=\'X\'] in xpath expr does NOT emit ref', () => {
    const src = `<odoo>
  <record model="ir.ui.view" id="view_inherit">
    <field name="arch" type="xml">
      <xpath expr="//group[@id='group_partner']" position="inside">
        <field name="name"/>
      </xpath>
    </field>
  </record>
</odoo>`;
    // @id patterns must not emit refs (spec 2.10)
    expect(refNames(src)).not.toContain('group_partner');
  });
});

// ---------------------------------------------------------------------------
// Spec Phase 1 — ir.sequence / ir.config_parameter dual variable nodes
// ---------------------------------------------------------------------------

describe('OdooExtractor — ir.sequence dual variable node (Phase 1)', () => {
  it('creates a variable node with qualifiedName ir.sequence::{code}', () => {
    const src = `<odoo>
  <record id="seq_detraction" model="ir.sequence">
    <field name="name">Detraction Sequence</field>
    <field name="code">account.detraction.customer</field>
    <field name="prefix">DET</field>
  </record>
</odoo>`;
    const qnames = nodeQNames(src);
    expect(qnames).toContain('ir.sequence::account.detraction.customer');
  });

  it('the sequence record node itself still exists', () => {
    const src = `<odoo>
  <record id="seq_test" model="ir.sequence">
    <field name="code">sale.order</field>
  </record>
</odoo>`;
    const nodes = extract(src).nodes;
    const seqNode = nodes.find(n => n.qualifiedName === 'ir.sequence::sale.order');
    expect(seqNode).toBeDefined();
    expect(seqNode?.kind).toBe('variable');
    expect(seqNode?.signature).toBe('sequence code');
  });
});

describe('OdooExtractor — ir.config_parameter dual variable node (Phase 1)', () => {
  it('creates a variable node with qualifiedName config_param::{key}', () => {
    const src = `<odoo>
  <record id="param_web_base" model="ir.config_parameter">
    <field name="key">web.base.url</field>
    <field name="value">http://localhost:8069</field>
  </record>
</odoo>`;
    const qnames = nodeQNames(src);
    expect(qnames).toContain('config_param::web.base.url');
  });

  it('config_param node has correct kind and signature', () => {
    const src = `<odoo>
  <record id="param_test" model="ir.config_parameter">
    <field name="key">mail.catchall.domain</field>
  </record>
</odoo>`;
    const nodes = extract(src).nodes;
    const paramNode = nodes.find(n => n.qualifiedName === 'config_param::mail.catchall.domain');
    expect(paramNode?.kind).toBe('variable');
    expect(paramNode?.signature).toBe('config_param key');
  });
});

// ---------------------------------------------------------------------------
// Spec Phase 4 — domain field refs from domain_force and domain fields
// ---------------------------------------------------------------------------

describe('OdooExtractor — domain_force field refs (Phase 4.1)', () => {
  it('extracts field names from ir.rule domain_force tuples', () => {
    const src = `<odoo>
  <record id="rule_partner" model="ir.rule">
    <field name="name">Partner rule</field>
    <field name="model_id" ref="base.model_res_partner"/>
    <field name="domain_force">[('partner_id', '=', user.id), ('state', 'in', ['draft'])]</field>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('partner_id');
    expect(r).toContain('state');
  });

  it('skips logical operators | & !', () => {
    const src = `<odoo>
  <record id="rule_multi" model="ir.rule">
    <field name="domain_force">['|', ('partner_id', '=', uid), ('user_id', '=', uid)]</field>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('partner_id');
    expect(r).toContain('user_id');
    expect(r).not.toContain('|');
  });

  it('splits dotted field paths like partner_id.name', () => {
    const src = `<odoo>
  <record id="rule_dotted" model="ir.rule">
    <field name="domain_force">[('partner_id.name', 'like', 'test')]</field>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('partner_id');
    expect(r).toContain('name');
  });
});

describe('OdooExtractor — domain field refs in act_window (Phase 4.2)', () => {
  it('extracts field refs from <field name="domain"> in act_window record', () => {
    const src = `<odoo>
  <record id="action_orders" model="ir.actions.act_window">
    <field name="name">Sale Orders</field>
    <field name="res_model">sale.order</field>
    <field name="domain">[('state', '!=', 'cancel')]</field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('state');
  });
});

describe('OdooExtractor — context default_ field refs (Phase 4.3)', () => {
  it('extracts default_X key as field ref', () => {
    const src = `<odoo>
  <record id="action_partner" model="ir.actions.act_window">
    <field name="context">{'default_partner_id': active_id, 'default_move_type': 'in_invoice'}</field>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('partner_id');
    expect(r).toContain('move_type');
  });

  it('emits context_key:: refs for all dict keys', () => {
    const src = `<odoo>
  <record id="action_ctx" model="ir.actions.act_window">
    <field name="context">{'active_test': False}</field>
  </record>
</odoo>`;
    expect(refNames(src)).toContain('context_key::active_test');
  });
});

describe('OdooExtractor — eval ref() xml_id refs (Phase 4.8)', () => {
  it('extracts xml_id from eval="[(4, ref(\'X\'))]"', () => {
    const src = `<odoo>
  <record id="group_manager" model="res.groups">
    <field name="implied_ids" eval="[(4, ref('base.group_user'))]"/>
    <field name="users" eval="[(4, ref('base.user_root'))]"/>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('base.group_user');
    expect(r).toContain('base.user_root');
  });
});

// ---------------------------------------------------------------------------
// Spec Phase 4 — arch content: t-field and t-on-* patterns
// ---------------------------------------------------------------------------

describe('OdooExtractor — t-field segment refs in arch (Phase 4.4)', () => {
  it('emits each path segment from t-field="object.partner_id"', () => {
    const src = `<odoo>
  <record id="report_view" model="ir.ui.view">
    <field name="arch" type="xml">
      <t t-foreach="docs" t-as="o">
        <span t-field="o.partner_id"/>
        <span t-field="o.amount_total"/>
      </t>
    </field>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('partner_id');
    expect(r).toContain('amount_total');
  });
});

describe('OdooExtractor — t-on-* method refs in arch (Phase 4.5)', () => {
  it('emits method ref from t-on-click attribute', () => {
    const src = `<odoo>
  <record id="owl_view" model="ir.ui.view">
    <field name="arch" type="xml">
      <button t-on-click="onConfirm" class="btn-primary"/>
      <input t-on-change="onAmountChange"/>
    </field>
  </record>
</odoo>`;
    const r = refNames(src);
    expect(r).toContain('onConfirm');
    expect(r).toContain('onAmountChange');
  });
});

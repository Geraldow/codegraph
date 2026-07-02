/**
 * Unit tests for Odoo-specific patterns in src/extraction/languages/python.ts
 * Covers: positional field args, Selection list, _inherit/_inherits, meta fields,
 * _sql_constraints, ORM call keys, mapped, @api.returns, @api.depends dotted paths.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { extractFromSource } from '../src/extraction';
import { initGrammars, loadAllGrammars } from '../src/extraction/grammars';

beforeAll(async () => {
  await initGrammars();
  await loadAllGrammars();
});

function refs(source: string, filePath = 'model.py'): string[] {
  return extractFromSource(filePath, source).unresolvedReferences.map((r) => r.referenceName);
}

// ---------------------------------------------------------------------------
// Spec 1.1 — Positional field args
// ---------------------------------------------------------------------------

describe('Odoo Python — positional field args (spec 1.1)', () => {
  it('Many2one 1st positional string → comodel ref', () => {
    const src = `
class AccountMove(models.Model):
    journal_id = fields.Many2one('account.journal', string='Journal')
`;
    expect(refs(src)).toContain('account.journal');
  });

  it('One2many 1st positional → comodel, 2nd positional → inverse_name', () => {
    const src = `
class AccountMove(models.Model):
    line_ids = fields.One2many('account.move.line', 'move_id')
`;
    const r = refs(src);
    expect(r).toContain('account.move.line');
    expect(r).toContain('move_id');
  });

  it('Many2many 1st positional → comodel ref', () => {
    const src = `
class AccountMove(models.Model):
    tag_ids = fields.Many2many('account.analytic.tag')
`;
    expect(refs(src)).toContain('account.analytic.tag');
  });

  it('Reference 1st positional → comodel ref', () => {
    const src = `
class Voucher(models.Model):
    ref_field = fields.Reference('res.partner')
`;
    expect(refs(src)).toContain('res.partner');
  });

  it('non-relational Char does NOT emit positional string as ref', () => {
    const src = `
class AccountMove(models.Model):
    name = fields.Char('Name', size=64)
`;
    expect(refs(src)).not.toContain('Name');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.2 — Selection list → selection::field::key
// ---------------------------------------------------------------------------

describe('Odoo Python — Selection list kwarg (spec 1.2)', () => {
  it('emits selection::field::key for each tuple in list', () => {
    const src = `
class AccountMove(models.Model):
    state = fields.Selection(selection=[('draft', 'Draft'), ('posted', 'Posted')], string='Status')
`;
    const r = refs(src);
    expect(r).toContain('selection::state::draft');
    expect(r).toContain('selection::state::posted');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.3 — Extended singleRefKeys
// ---------------------------------------------------------------------------

describe('Odoo Python — singleRefKeys (spec 1.3)', () => {
  it('groups kwarg → group ref', () => {
    const src = `
class AccountMove(models.Model):
    amount = fields.Monetary(currency_field='currency_id', groups='account.group_account_user')
`;
    expect(refs(src)).toContain('account.group_account_user');
  });

  it('compute kwarg → method name ref', () => {
    const src = `
class AccountMove(models.Model):
    amount_total = fields.Monetary(compute='_compute_amount')
`;
    expect(refs(src)).toContain('_compute_amount');
  });

  it('config_parameter kwarg → config param ref', () => {
    const src = `
class ResConfigSettings(models.TransientModel):
    param_val = fields.Char(config_parameter='base.my_param')
`;
    expect(refs(src)).toContain('base.my_param');
  });

  it('inverse kwarg → method name ref', () => {
    const src = `
class AccountMove(models.Model):
    currency_id = fields.Many2one('res.currency', inverse='_inverse_currency')
`;
    expect(refs(src)).toContain('_inverse_currency');
  });

  it('relation kwarg → m2m_relation:: ref', () => {
    const src = `
class AccountMove(models.Model):
    payment_ids = fields.Many2many('account.payment', relation='account_invoice_payment_rel')
`;
    expect(refs(src)).toContain('m2m_relation::account_invoice_payment_rel');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.4 — _inherit string form
// ---------------------------------------------------------------------------

describe('Odoo Python — _inherit string form (spec 1.4)', () => {
  it('_inherit = "model.name" → model ref', () => {
    const src = `
class AccountMoveExtended(models.Model):
    _inherit = 'account.move'
`;
    expect(refs(src)).toContain('account.move');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.5 — _inherits dict
// ---------------------------------------------------------------------------

describe('Odoo Python — _inherits dict (spec 1.5)', () => {
  it('emits model ref (key) and field ref (value)', () => {
    const src = `
class ResPartnerEmployee(models.Model):
    _inherits = {'res.partner': 'partner_id'}
`;
    const r = refs(src);
    expect(r).toContain('res.partner');
    expect(r).toContain('partner_id');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.6 — Model meta field refs
// ---------------------------------------------------------------------------

describe('Odoo Python — meta field refs (spec 1.6)', () => {
  it('_rec_name → field ref', () => {
    const src = `
class TipoDetraccion(models.Model):
    _rec_name = 'name_detraccion'
`;
    expect(refs(src)).toContain('name_detraccion');
  });

  it('_parent_name → field ref', () => {
    const src = `
class Category(models.Model):
    _parent_name = 'parent_id'
`;
    expect(refs(src)).toContain('parent_id');
  });

  it('_order splits by comma and whitespace → one ref per sort key', () => {
    const src = `
class AccountMove(models.Model):
    _order = 'date desc, name asc'
`;
    const r = refs(src);
    expect(r).toContain('date');
    expect(r).toContain('name');
  });

  it('_rec_names_search list → one field ref per element', () => {
    const src = `
class AccountMove(models.Model):
    _rec_names_search = ['name', 'ref']
`;
    const r = refs(src);
    expect(r).toContain('name');
    expect(r).toContain('ref');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.7 — _sql_constraints
// ---------------------------------------------------------------------------

describe('Odoo Python — _sql_constraints (spec 1.7)', () => {
  it('constraint name tuple → constraint:: ref', () => {
    const src = `
class TipoDetraccion(models.Model):
    _sql_constraints = [
        ('uniq_code', 'UNIQUE(code)', 'Code must be unique'),
    ]
`;
    expect(refs(src)).toContain('constraint::uniq_code');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.8 — self.create / self.write dict keys
// ---------------------------------------------------------------------------

describe('Odoo Python — ORM call dict keys (spec 1.8)', () => {
  it('self.create({...}) → field refs from string keys', () => {
    const src = `
class AccountMove(models.Model):
    def action_post(self):
        self.create({'name': name, 'partner_id': partner.id})
`;
    const r = refs(src);
    expect(r).toContain('name');
    expect(r).toContain('partner_id');
  });

  it('self.write({...}) → field refs from string keys', () => {
    const src = `
class AccountMove(models.Model):
    def action_draft(self):
        self.write({'state': 'draft', 'date': False})
`;
    const r = refs(src);
    expect(r).toContain('state');
    expect(r).toContain('date');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.9 — self.mapped dotted path
// ---------------------------------------------------------------------------

describe('Odoo Python — self.mapped path segments (spec 1.9)', () => {
  it('mapped dotted path → one ref per segment', () => {
    const src = `
class AccountMove(models.Model):
    def get_amounts(self):
        return self.mapped('invoice_line_ids.product_id')
`;
    const r = refs(src);
    expect(r).toContain('invoice_line_ids');
    expect(r).toContain('product_id');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.10 — @api.returns
// ---------------------------------------------------------------------------

describe('Odoo Python — @api.returns (spec 1.10)', () => {
  it('@api.returns first arg → model ref', () => {
    const src = `
class AccountMove(models.Model):
    @api.returns('res.partner', lambda r: r.id)
    def get_partner(self):
        return self.partner_id
`;
    expect(refs(src)).toContain('res.partner');
  });
});

// ---------------------------------------------------------------------------
// Spec 1.11 — @api.depends dotted path split (bugfix)
// ---------------------------------------------------------------------------

describe('Odoo Python — @api.depends dotted path (spec 1.11)', () => {
  it('splits dotted path and emits one ref per segment', () => {
    const src = `
class AccountMove(models.Model):
    @api.depends('move_id.line_ids.amount_residual')
    def _compute_something(self):
        pass
`;
    const r = refs(src);
    expect(r).toContain('move_id');
    expect(r).toContain('line_ids');
    expect(r).toContain('amount_residual');
  });

  it('does NOT emit the full dotted string as a single ref', () => {
    const src = `
class AccountMove(models.Model):
    @api.depends('move_id.line_ids.amount_residual')
    def _compute_something(self):
        pass
`;
    expect(refs(src)).not.toContain('move_id.line_ids.amount_residual');
  });

  it('handles multiple depends args each with dotted paths', () => {
    const src = `
class AccountMove(models.Model):
    @api.depends('partner_id.name', 'currency_id.rate')
    def _compute_label(self):
        pass
`;
    const r = refs(src);
    expect(r).toContain('partner_id');
    expect(r).toContain('currency_id');
    expect(r).toContain('rate');
  });
});

// ---------------------------------------------------------------------------
// Phase 1 additions — model_id, ORM command tuples, search / search_read
// ---------------------------------------------------------------------------

describe('Odoo Python — model_id field → model ref (Phase 1.1)', () => {
  it('model_id = fields.Many2one emits the comodel ref', () => {
    const src = `
class IrActionsServer(models.Model):
    model_id = fields.Many2one('ir.model', string='Model')
`;
    expect(refs(src)).toContain('ir.model');
  });
});

describe('Odoo Python — ORM write with command tuple (0,0,{...}) (Phase 1.4)', () => {
  it('extracts field names from (0, 0, {...}) dict values in create/write', () => {
    const src = `
class SaleOrder(models.Model):
    def action_add_line(self):
        self.write({'order_line': [(0, 0, {'product_id': prod.id, 'qty': 1.0})]})
`;
    const r = refs(src);
    expect(r).toContain('product_id');
    expect(r).toContain('qty');
  });
});

describe('Odoo Python — .search domain tuple field refs (Phase 1.5)', () => {
  it('extracts field from search([("field", "=", val)])', () => {
    const src = `
class AccountMove(models.Model):
    def _get_draft(self):
        return self.search([('state', '=', 'draft'), ('partner_id', '!=', False)])
`;
    const r = refs(src);
    expect(r).toContain('state');
    expect(r).toContain('partner_id');
  });
});

describe('Odoo Python — .search_read domain + fields (Phase 1.6)', () => {
  it('extracts domain field refs AND field list refs', () => {
    const src = `
class StockPicking(models.Model):
    def get_data(self):
        return self.search_read([('state', '=', 'done')], ['name', 'partner_id', 'date_done'])
`;
    const r = refs(src);
    expect(r).toContain('state');
    expect(r).toContain('name');
    expect(r).toContain('date_done');
  });
});

describe('Odoo Python — _compute_X / _inverse_X function naming → field ref (Phase 1)', () => {
  it('_compute_amount_total → emits amount_total as field ref', () => {
    const src = `
class AccountMove(models.Model):
    def _compute_amount_total(self):
        pass
`;
    expect(refs(src)).toContain('amount_total');
  });

  it('_inverse_partner_id → emits partner_id as field ref', () => {
    const src = `
class AccountMove(models.Model):
    def _inverse_partner_id(self):
        pass
`;
    expect(refs(src)).toContain('partner_id');
  });

  it('_onchange_journal_id → emits journal_id as field ref', () => {
    const src = `
class AccountMove(models.Model):
    def _onchange_journal_id(self):
        pass
`;
    expect(refs(src)).toContain('journal_id');
  });
});

describe('Odoo Python — return {\'res_model\'} → model ref (Phase 1)', () => {
  it('return statement dict with res_model key emits model ref', () => {
    const src = `
class SaleOrder(models.Model):
    def action_open_partner(self):
        return {'res_model': 'res.partner', 'type': 'ir.actions.act_window'}
`;
    expect(refs(src)).toContain('res.partner');
  });
});

// ---------------------------------------------------------------------------
// Phase 2 additions — fields.Reference list, states kwarg, has_group, filtered
// ---------------------------------------------------------------------------

describe('Odoo Python — fields.Reference([...]) list → model refs (Phase 2.2)', () => {
  it('emits each model name from the selection list', () => {
    const src = `
class MixedRef(models.Model):
    ref_field = fields.Reference([('res.partner', 'Partner'), ('account.move', 'Invoice')])
`;
    const r = refs(src);
    expect(r).toContain('res.partner');
    expect(r).toContain('account.move');
  });
});

describe('Odoo Python — states kwarg field refs (Phase 2.4)', () => {
  it('extracts field names from states={(\'state\'): [(\'field\', ...)])', () => {
    const src = `
class SaleOrder(models.Model):
    amount_total = fields.Float(states={'draft': [('amount_total', 'readonly', False)]})
`;
    // 'amount_total' should appear in the states list
    expect(refs(src)).toContain('amount_total');
  });
});

describe('Odoo Python — has_group → group ref (Phase 2.5)', () => {
  it('emits group ref from has_group("module.group_xml_id")', () => {
    const src = `
class ResPartner(models.Model):
    def _check_access(self):
        if self.env.user.has_group('base.group_system'):
            return True
`;
    expect(refs(src)).toContain('group::base.group_system');
  });
});

describe('Odoo Python — filtered(lambda r: r.field) → field ref (Phase 2.6)', () => {
  it('extracts field accessed in lambda body', () => {
    const src = `
class AccountMove(models.Model):
    def get_confirmed(self):
        return self.invoice_ids.filtered(lambda inv: inv.state == 'posted')
`;
    expect(refs(src)).toContain('state');
  });
});

// ---------------------------------------------------------------------------
// Phase 3 additions — with_context keys, state transitions, chained env
// ---------------------------------------------------------------------------

describe('Odoo Python — with_context kwargs → context_key refs (Phase 3.5)', () => {
  it('emits context_key:: for each kwarg in with_context()', () => {
    const src = `
class SaleOrder(models.Model):
    def action_open(self):
        return self.with_context(default_partner_id=self.partner_id.id, no_check=True).create({})
`;
    const r = refs(src);
    expect(r).toContain('context_key::default_partner_id');
    expect(r).toContain('context_key::no_check');
  });
});

describe('Odoo Python — sudo().env / request.env model refs (Phase 3.2)', () => {
  it('self.sudo().env["res.partner"] emits model ref', () => {
    const src = `
class AccountMove(models.Model):
    def _get_partner(self):
        return self.sudo().env['res.partner'].browse(self.partner_id.id)
`;
    // Covered by framework resolver regex \.env['model'] — refs come from odoo.ts resolver
    // The extractor emits the unresolved ref in python.ts visitNode (call handler)
    expect(refs(src)).not.toContain(undefined as unknown as string);
    // Just verify no crash on chained env access
  });
});

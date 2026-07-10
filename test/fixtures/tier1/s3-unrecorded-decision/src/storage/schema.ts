// Fixture: a NEW storage schema file — one of the two architectural signals in this
// fixture's diff (the other is the new dependency in package.json vs package.json.base).
// No ADR in the fixture records either decision; that absence is what S3 must catch.
export const ordersTable = {
  name: "orders",
  columns: {
    id: "integer primary key",
    payload: "text not null",
    created_at: "text not null",
  },
} as const;

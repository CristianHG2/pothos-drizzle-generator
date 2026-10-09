export const createInputOperator = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: PothosSchemaTypes.SchemaBuilder<any>,
  type: string | [string]
) => {
  const typeName = Array.isArray(type) ? `Array${type[0]}` : type;
  const name = `${typeName}InputOperator`;
  const inputType = builder.inputType(name, {
    fields: (t) => ({
      eq: t.field({ type }),
      ne: t.field({ type }),
      gt: t.field({ type }),
      gte: t.field({ type }),
      lt: t.field({ type }),
      lte: t.field({ type }),
      like: t.field({ type }),
      notLike: t.field({ type }),
      ilike: t.field({ type }),
      notIlike: t.field({ type }),
      isNull: t.boolean(),
      isNotNull: t.boolean(),
      in: t.field({ type: [type] as never }),
      notIn: t.field({ type: [type] as never }),
      arrayContained: t.field({ type: [type] as never }),
      arrayOverlaps: t.field({ type: [type] as never }),
      arrayContains: t.field({ type: [type] as never }),
    }),
  });
  return inputType;
};

export const createJsonbInputOperator = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder: PothosSchemaTypes.SchemaBuilder<any>,
  type: string | [string]
) => {
  const typeName = Array.isArray(type) ? `Array${type[0]}` : type;
  const name = `${typeName}bInputOperator`;
  const inputType = builder.inputType(name, {
    fields: (t) => ({
      eq: t.field({ type }),
      ne: t.field({ type }),
      isNull: t.boolean(),
      isNotNull: t.boolean(),
      in: t.field({ type: [type] as never }),
      notIn: t.field({ type: [type] as never }),
      contains: t.field({ type }),
      containedBy: t.field({ type }),
      hasKey: t.string(),
      hasAnyKeys: t.stringList(),
      hasAllKeys: t.stringList(),
    }),
  });
  return inputType;
};

// PostgREST caps responses; walk pages so exports and balances never truncate silently.
export async function readAll<T>(query: {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>
}): Promise<{ data: T[] }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await query.range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < 500) return { data: rows }
  }
}

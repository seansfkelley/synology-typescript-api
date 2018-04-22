export function series<T, U>(values: T[], makePromise: (value: T) => Promise<U>, defaultValue?: U): Promise<U> {
  if (values.length === 0) {
    return defaultValue == null
      ? Promise.reject('no values were given for series')
      : Promise.resolve(defaultValue);
  } else {
    let mutableValues = [ ...values ];

    function iterate(): Promise<U> {
      const value = mutableValues.shift()!;
      return makePromise(value)
        .catch(e => mutableValues.length > 0
          ? iterate()
          : Promise.reject(e)
        );
    }

    return iterate();
  }
}

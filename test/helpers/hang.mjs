export default async function hang() {
  setInterval(() => {}, 10000);
  await new Promise(() => {});
}

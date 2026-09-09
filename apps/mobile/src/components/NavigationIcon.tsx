import { StyleSheet, View } from 'react-native';

type Name = 'today' | 'work' | 'apply' | 'growth' | 'profile';

export default function NavigationIcon({ name, color }: { name: Name; color: string }) {
  if (name === 'today') {
    return <View accessible={false} style={[styles.sun, { borderColor: color }]}><View style={[styles.sunCore, { backgroundColor: color }]} /></View>;
  }
  if (name === 'work') {
    return <View accessible={false} style={styles.icon}><View style={[styles.searchRing, { borderColor: color }]} /><View style={[styles.searchHandle, { backgroundColor: color }]} /></View>;
  }
  if (name === 'apply') {
    return <View accessible={false} style={[styles.document, { borderColor: color }]}><View style={[styles.docLine, { backgroundColor: color }]} /><View style={[styles.docLine, styles.docLineShort, { backgroundColor: color }]} /></View>;
  }
  if (name === 'growth') {
    return <View accessible={false} style={styles.bars}><View style={[styles.bar, { height: 7, backgroundColor: color }]} /><View style={[styles.bar, { height: 12, backgroundColor: color }]} /><View style={[styles.bar, { height: 18, backgroundColor: color }]} /></View>;
  }
  return <View accessible={false} style={styles.profile}><View style={[styles.head, { backgroundColor: color }]} /><View style={[styles.shoulders, { borderColor: color }]} /></View>;
}

const styles = StyleSheet.create({
  icon: { width: 24, height: 24 },
  sun: { width: 21, height: 21, borderWidth: 1.5, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sunCore: { width: 7, height: 7, borderRadius: 4 },
  searchRing: { position: 'absolute', left: 2, top: 2, width: 14, height: 14, borderWidth: 2, borderRadius: 8 },
  searchHandle: { position: 'absolute', width: 9, height: 2, borderRadius: 1, transform: [{ rotate: '45deg' }], left: 14, top: 16 },
  document: { width: 19, height: 22, borderWidth: 1.7, borderRadius: 4, paddingHorizontal: 4, justifyContent: 'center', gap: 4 },
  docLine: { height: 2, borderRadius: 1, width: 9 },
  docLineShort: { width: 6 },
  bars: { width: 23, height: 22, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 3 },
  bar: { width: 4, borderRadius: 2 },
  profile: { width: 24, height: 24, alignItems: 'center' },
  head: { width: 8, height: 8, borderRadius: 4, top: 2 },
  shoulders: { position: 'absolute', bottom: 1, width: 18, height: 10, borderWidth: 1.7, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
});

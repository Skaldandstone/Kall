import Ionicons from '@expo/vector-icons/Ionicons';

type Name = 'today' | 'work' | 'apply' | 'growth' | 'profile';

export default function NavigationIcon({ name, color }: { name: Name; color: string }) {
  const icons: Record<Name, keyof typeof Ionicons.glyphMap> = {
    today: 'sparkles-outline',
    work: 'compass-outline',
    apply: 'layers-outline',
    growth: 'trending-up-outline',
    profile: 'person-circle-outline',
  };
  return <Ionicons accessible={false} name={icons[name]} color={color} size={23} />;
}

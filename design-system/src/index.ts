/*
 * TANAW design system. Import from the synced copy in each app, for example:
 *   import { Button, Badge, MetricStrip } from "../design-system";
 */

// Primitives
export { Alert, type AlertProps, type AlertTone } from "./components/Alert";
export { Avatar, type AvatarProps } from "./components/Avatar";
export { Badge, type BadgeProps, type BadgeTone } from "./components/Badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./components/Button";
export { Card, CardFooter, CardHeader, type CardHeaderProps, type CardPadding, type CardProps } from "./components/Card";
export { Checkbox, type CheckboxProps } from "./components/Checkbox";
export { ConfirmDialog, type ConfirmDialogProps } from "./components/ConfirmDialog";
export { DetailField, DetailList, type DetailFieldProps, type DetailListProps } from "./components/DetailField";
export { Dialog, type DialogProps, type DialogSize } from "./components/Dialog";
export { EmptyState, type EmptyStateProps } from "./components/EmptyState";
export { ExpandableText, type ExpandableTextProps } from "./components/ExpandableText";
export { Field, type FieldProps } from "./components/Field";
export { IconButton, type IconButtonProps, type IconButtonVariant } from "./components/IconButton";
export { Input, Textarea, controlClassName, type InputProps, type TextareaProps } from "./components/Input";
export { ModalPortal, type ModalPortalProps } from "./components/ModalPortal";
export { ProgressBar, type ProgressBarProps } from "./components/ProgressBar";
export { SearchField, type SearchFieldProps } from "./components/SearchField";
export { SectionLabel, type SectionLabelProps } from "./components/SectionLabel";
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from "./components/SegmentedControl";
export { Select, type SelectOption, type SelectProps } from "./components/Select";
export { Skeleton, Spinner, type SkeletonProps, type SpinnerProps } from "./components/Spinner";
export { StatusDot, type StatusDotProps, type StatusDotTone } from "./components/StatusDot";
export { Switch, type SwitchProps } from "./components/Switch";
export { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, type TableCellProps, type TableHeaderCellProps, type TableProps, type TableRowProps } from "./components/Table";
export { Tabs, type TabItem, type TabsProps } from "./components/Tabs";
export { Tooltip, type TooltipProps } from "./components/Tooltip";

// Patterns
export { MetricStrip, type Metric, type MetricStripControl, type MetricStripProps, type MetricTone } from "./patterns/MetricStrip";
export { PageHeader, type PageHeaderProps } from "./patterns/PageHeader";
export { PasswordMatchIndicator, PasswordRequirements, type PasswordMatchIndicatorProps, type PasswordRequirementStatus, type PasswordRequirementsProps } from "./patterns/PasswordRequirements";
export { TopbarNavigation } from "./patterns/TopbarNavigation";

// Helpers
export { cn } from "./lib/cn";
export { DROPDOWN_SEARCH_MIN_OPTIONS, getNextDropdownIndex, shouldShowDropdownSearch, type DropdownKey } from "./lib/dropdown";
export { useDialogFocus } from "./lib/focus-trap";
export { initialsOf } from "./lib/initials";
export { dialogIn, fadeInDown, popIn } from "./lib/motion";
export { hasVisualOverflow } from "./lib/overflow";
export { useExclusivePopupDismissal } from "./lib/popup-dismissal";
export { toSentenceCase } from "./lib/sentence-case";
